const {
  createBot,
  createProvider,
  createFlow,
  addKeyword,
  EVENTS,
} = require("@bot-whatsapp/bot");
require("dotenv").config();
const QRPortalWeb = require("@bot-whatsapp/portal");
const BaileysProvider = require("@bot-whatsapp/provider/baileys");
const mongoAdapter = require("@bot-whatsapp/database/mongo");
const { chat } = require("./ai");
const path = require("path");
const fs = require("fs");

const pathConsultas = path.join(__dirname, "mensajes", "promptConsultas.txt");
const promptConsultas = fs.readFileSync(pathConsultas, "utf-8");

// ===== CONTROL DE SESIONES =====
const sesionesActivas = new Map();
const mensajesPendientes = new Map(); // Evitar mensajes duplicados
const TIMEOUT_SESION = 10 * 60 * 1000; // 10 minutos
const DELAY_ANTI_SPAM = 1000; // 1 segundo entre respuestas del bot

const iniciarSesion = (userId, modo = null) => {
  sesionesActivas.set(userId, {
    modo: modo, // null, 'menu', 'soporte', 'faq'
    ultimaInteraccion: Date.now(),
    esperandoRespuesta: false,
  });
};

const obtenerSesion = (userId) => {
  return sesionesActivas.get(userId);
};

const actualizarSesion = (userId, datos = {}) => {
  const sesion = sesionesActivas.get(userId);
  if (sesion) {
    Object.assign(sesion, {
      ...datos,
      ultimaInteraccion: Date.now(),
    });
  }
};

const cerrarSesion = (userId) => {
  sesionesActivas.delete(userId);
  mensajesPendientes.delete(userId);
};

const sesionActiva = (userId) => {
  const sesion = obtenerSesion(userId);
  if (!sesion) return false;

  if (Date.now() - sesion.ultimaInteraccion > TIMEOUT_SESION) {
    cerrarSesion(userId);
    return false;
  }

  return true;
};

// Evitar procesar el mismo mensaje varias veces
const yaProcesado = (userId, mensaje) => {
  const key = `${userId}_${mensaje}`;
  if (mensajesPendientes.has(key)) {
    return true;
  }
  mensajesPendientes.set(key, Date.now());
  
  // Limpiar mensajes viejos cada 30 segundos
  setTimeout(() => mensajesPendientes.delete(key), 30000);
  return false;
};

const esDespedida = (texto) => {
  const despedidas = ["gracias", "adiós", "chao", "bye", "listo", "ok gracias", "salir", "cancelar"];
  const textoLower = texto.toLowerCase().trim();
  return despedidas.some((d) => textoLower === d || textoLower.includes(` ${d}`) || textoLower.includes(`${d} `));
};

const esMenu = (texto) => {
  const textoLower = texto.toLowerCase().trim();
  return textoLower === "menu" || textoLower === "menú" || textoLower === "volver";
};

// ===== PREGUNTAS FRECUENTES =====
const preguntasFrecuentes = {
  "1": "Ingresa a *app.saluto.com* con tu usuario y contraseña. Si olvidaste tus datos, escribe a soporte@saluto.com",
  "2": "Menú principal > Pacientes > Nuevo Paciente. Llena los datos y ya puedes registrar consultas",
  "3": "Agenda > Nueva Cita. Selecciona paciente, fecha, hora y profesional",
  "4": "Desde la consulta > Facturar. Verifica servicios y dale a Generar",
  "5": "No, necesitas internet porque todo se guarda en la nube para seguridad",
  "6": "Verifica tu conexión, limpia caché o prueba en modo incógnito. Si persiste: soporte@saluto.com"
};

// ===== FLOW 1: INICIO =====
const flowInicio = addKeyword(["saluto", "ayuda", "hola", "inicio"])
  .addAnswer(
    "Hola 👋 Soy el asistente de *SALUTO*\n\n1️⃣ Soporte técnico\n2️⃣ Preguntas frecuentes\n\nResponde *1* o *2*",
    { capture: true },
    async (ctx, { gotoFlow, flowDynamic, fallBack }) => {
      const userId = ctx.from;
      const mensaje = ctx.body.trim();

      // Evitar duplicados
      if (yaProcesado(userId, mensaje)) return;

      const opcion = mensaje;

      if (opcion === "1") {
        iniciarSesion(userId, 'soporte');
        return gotoFlow(flowSoporte);
      } else if (opcion === "2") {
        iniciarSesion(userId, 'faq');
        return gotoFlow(flowPreguntas);
      } else {
        await flowDynamic("Escribe *1* o *2*");
        return fallBack();
      }
    }
  );

// ===== FLOW 2: SOPORTE =====
const flowSoporte = addKeyword(EVENTS.ACTION)
  .addAnswer(
    "¿En qué te ayudo? 🤓",
    { capture: true },
    async (ctx, { flowDynamic, fallBack, endFlow }) => {
      const userId = ctx.from;
      const mensaje = ctx.body.trim();

      if (yaProcesado(userId, mensaje)) return;

      // Comandos especiales
      if (esDespedida(mensaje)) {
        cerrarSesion(userId);
        await flowDynamic("Listo, escribe *saluto* cuando necesites 👍");
        return endFlow();
      }

      if (esMenu(mensaje)) {
        cerrarSesion(userId);
        await flowDynamic("Escribe *saluto* para volver al menú");
        return endFlow();
      }

      // Validar mensaje no vacío
      if (!mensaje || mensaje.length < 3) {
        await flowDynamic("Escribe tu consulta con más detalle");
        return fallBack();
      }

      // Procesar con IA
      try {
        const sesion = obtenerSesion(userId);
        
        // Evitar múltiples consultas simultáneas
        if (sesion && sesion.esperandoRespuesta) {
          return;
        }

        actualizarSesion(userId, { esperandoRespuesta: true });

        const prompt = `${promptConsultas}\n\nUsuario: ${mensaje}`;
        const response = await Promise.race([
          chat(prompt),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 25000)
          )
        ]);

        if (response && response.trim()) {
          await flowDynamic(response);
        } else {
          await flowDynamic("No pude generar una respuesta. Intenta reformular tu pregunta");
        }

        actualizarSesion(userId, { esperandoRespuesta: false });
        
      } catch (error) {
        console.error("Error en IA:", error.message);
        actualizarSesion(userId, { esperandoRespuesta: false });
        
        await flowDynamic(
          "No pude procesar tu consulta. Para ayuda directa escribe a *soporte@saluto.com*"
        );
      }

      return fallBack();
    }
  );

// ===== FLOW 3: PREGUNTAS FRECUENTES =====
const flowPreguntas = addKeyword(EVENTS.ACTION)
  .addAnswer(
    "📋 *Preguntas Frecuentes*\n\n1. ¿Cómo accedo?\n2. Crear historia clínica\n3. Agendar cita\n4. Generar factura\n5. ¿Funciona sin internet?\n6. Problemas de acceso\n\nEscribe el *número*",
    { capture: true },
    async (ctx, { flowDynamic, fallBack, endFlow }) => {
      const userId = ctx.from;
      const mensaje = ctx.body.trim();

      if (yaProcesado(userId, mensaje)) return;

      // Comandos especiales
      if (esDespedida(mensaje)) {
        cerrarSesion(userId);
        await flowDynamic("¡Perfecto! 👋");
        return endFlow();
      }

      if (esMenu(mensaje)) {
        cerrarSesion(userId);
        await flowDynamic("Escribe *saluto* para el menú");
        return endFlow();
      }

      // Procesar FAQ
      const respuesta = preguntasFrecuentes[mensaje];
      
      if (respuesta) {
        await flowDynamic(respuesta);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await flowDynamic("¿Otra pregunta? Escribe el número o *saluto* para el menú");
        actualizarSesion(userId);
        return fallBack();
      } else {
        await flowDynamic("Elige un número del 1 al 6");
        return fallBack();
      }
    }
  );

// ===== FLOW 4: CONVERSACIÓN CONTINUA =====
const flowConversacion = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, fallBack, endFlow }) => {
    const userId = ctx.from;
    const mensaje = ctx.body.trim();

    // Ignorar si no hay sesión activa
    if (!sesionActiva(userId)) {
      return endFlow();
    }

    // Evitar duplicados
    if (yaProcesado(userId, mensaje)) return;

    const sesion = obtenerSesion(userId);

    // Comandos globales
    if (esDespedida(mensaje)) {
      cerrarSesion(userId);
      await flowDynamic("¡Hasta luego! Escribe *saluto* cuando necesites 👋");
      return endFlow();
    }

    if (esMenu(mensaje)) {
      cerrarSesion(userId);
      await flowDynamic("Escribe *saluto* para volver");
      return endFlow();
    }

    // Continuar en el modo activo
    if (sesion.modo === 'soporte') {
      // Validar mensaje
      if (!mensaje || mensaje.length < 3) {
        await flowDynamic("Escribe tu consulta");
        return fallBack();
      }

      // Evitar múltiples consultas simultáneas
      if (sesion.esperandoRespuesta) {
        return;
      }

      try {
        actualizarSesion(userId, { esperandoRespuesta: true });

        const prompt = `${promptConsultas}\n\nUsuario: ${mensaje}`;
        const response = await Promise.race([
          chat(prompt),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Timeout")), 25000)
          )
        ]);

        if (response && response.trim()) {
          await flowDynamic(response);
        } else {
          await flowDynamic("No pude generar respuesta. Escribe a *soporte@saluto.com*");
        }

        actualizarSesion(userId, { esperandoRespuesta: false });

      } catch (error) {
        console.error("Error en IA:", error.message);
        actualizarSesion(userId, { esperandoRespuesta: false });
        await flowDynamic("Error al procesar. Contacta a *soporte@saluto.com*");
      }

      return fallBack();
    }

    if (sesion.modo === 'faq') {
      const respuesta = preguntasFrecuentes[mensaje];
      
      if (respuesta) {
        await flowDynamic(respuesta);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await flowDynamic("¿Otra pregunta? Número o *saluto* para menú");
        actualizarSesion(userId);
        return fallBack();
      } else {
        await flowDynamic("Número del 1 al 6");
        return fallBack();
      }
    }

    return endFlow();
  }
);

// ===== INICIALIZACIÓN =====
const main = async () => {
  try {
    const adapterDB = new mongoAdapter({
      dbUri: process.env.MONGO_DB_API,
      dbName: "bot-whatsapp",
      opts: {
        serverApi: { version: "1", strict: true, deprecationErrors: true },
        tls: true,
        tlsInsecure: false,
        retryWrites: true,
        w: "majority",
      },
    });

    const adapterFlow = createFlow([
      flowInicio,
      flowSoporte,
      flowPreguntas,
      flowConversacion,
    ]);

    const adapterProvider = createProvider(BaileysProvider);

    createBot({
      flow: adapterFlow,
      provider: adapterProvider,
      database: adapterDB,
    });

    QRPortalWeb();

    console.log("✅ Bot SALUTO iniciado correctamente");

    // Limpiar sesiones expiradas cada 5 minutos
    setInterval(() => {
      const ahora = Date.now();
      for (const [userId, sesion] of sesionesActivas.entries()) {
        if (ahora - sesion.ultimaInteraccion > TIMEOUT_SESION) {
          cerrarSesion(userId);
        }
      }
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error("❌ Error al iniciar el bot:", error);
    process.exit(1);
  }
};

main();