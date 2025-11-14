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

// Control de sesiones
const sesionesActivas = new Map();
const TIMEOUT_SESION = 10 * 60 * 1000;

const iniciarSesion = (userId) => {
  sesionesActivas.set(userId, {
    activa: true,
    ultimaInteraccion: Date.now(),
    enSoporte: false,
  });
};

const cerrarSesion = (userId) => {
  sesionesActivas.delete(userId);
};

const sesionActiva = (userId) => {
  const sesion = sesionesActivas.get(userId);
  if (!sesion) return false;

  if (Date.now() - sesion.ultimaInteraccion > TIMEOUT_SESION) {
    cerrarSesion(userId);
    return false;
  }

  return sesion.activa;
};

const actualizarSesion = (userId, enSoporte = false) => {
  const sesion = sesionesActivas.get(userId);
  if (sesion) {
    sesion.ultimaInteraccion = Date.now();
    sesion.enSoporte = enSoporte;
  }
};

const estaEnSoporte = (userId) => {
  const sesion = sesionesActivas.get(userId);
  return sesion?.enSoporte || false;
};

const despedidas = [
  "gracias", "adiós", "chao", "nos vemos", "bye", 
  "listo", "ok gracias", "salir", "cancelar"
];

const esDespedida = (texto) => {
  const textoLower = texto.toLowerCase().trim();
  return despedidas.some((palabra) => textoLower.includes(palabra));
};

// Preguntas frecuentes
const preguntasFrecuentes = {
  "1": {
    pregunta: "¿Cómo accedo a SALUTO?",
    respuesta: "Ingresa a app.saluto.com con tu usuario y contraseña. Si olvidaste tus datos, escribe a soporte@saluto.com"
  },
  "2": {
    pregunta: "¿Cómo crear una historia clínica?",
    respuesta: "Desde el menú principal > Pacientes > Nuevo Paciente. Llena los datos básicos y listo, ya puedes registrar consultas."
  },
  "3": {
    pregunta: "¿Cómo agendar una cita?",
    respuesta: "Ve a Agenda > Nueva Cita. Selecciona paciente, fecha, hora y profesional. ¡Así de fácil!"
  },
  "4": {
    pregunta: "¿Cómo generar una factura?",
    respuesta: "Desde la consulta del paciente > Facturar. Verifica los servicios y dale a Generar. Se crea automáticamente."
  },
  "5": {
    pregunta: "¿SALUTO funciona sin internet?",
    respuesta: "No, necesitas conexión a internet porque todo se guarda en la nube para mayor seguridad y acceso desde cualquier lugar."
  },
  "6": {
    pregunta: "Problemas para entrar",
    respuesta: "Verifica tu conexión, limpia caché del navegador o prueba en modo incógnito. Si persiste: soporte@saluto.com"
  }
};

// FLOW 1: Saludo inicial con menú
const flowInicio = addKeyword(["saluto", "ayuda", "hola"])
  .addAnswer(
    "¡Hola! 👋 Soy el asistente de *SALUTO*\n\n¿Qué necesitas?\n\n1️⃣ Hablar con soporte\n2️⃣ Ver preguntas frecuentes\n\nResponde con *1* o *2*",
    { capture: true },
    async (ctx, { gotoFlow, flowDynamic, fallBack }) => {
      const userId = ctx.from;
      iniciarSesion(userId);

      const opcion = ctx.body.trim();

      if (opcion === "1") {
        actualizarSesion(userId, true);
        return gotoFlow(flowSoporte);
      } else if (opcion === "2") {
        return gotoFlow(flowPreguntas);
      } else {
        await flowDynamic("Por favor responde *1* para soporte o *2* para preguntas frecuentes");
        return fallBack();
      }
    }
  );

// FLOW 2: Soporte con IA
const flowSoporte = addKeyword(EVENTS.ACTION)
  .addAnswer(
    "Perfecto, ¿en qué puedo ayudarte? 🤓\n\n_(Escribe *salir* si quieres terminar)_",
    { capture: true },
    async (ctx, { flowDynamic, fallBack, endFlow }) => {
      const userId = ctx.from;
      const userMsg = ctx.body.trim();

      if (esDespedida(userMsg)) {
        cerrarSesion(userId);
        await flowDynamic("¡Listo! Cualquier cosa, escribe *saluto* de nuevo 👍");
        return endFlow();
      }

      try {
        const prompt = `${promptConsultas}\n\nUsuario: ${userMsg}`;
        const response = await chat(prompt);
        await flowDynamic(response);
      } catch (error) {
        console.error("Error en IA:", error);
        await flowDynamic("Ups, algo falló. ¿Puedes repetir?");
      }

      actualizarSesion(userId, true);
      return fallBack();
    }
  );

// FLOW 3: Preguntas frecuentes
const flowPreguntas = addKeyword(EVENTS.ACTION)
  .addAnswer(
    "📋 *Preguntas Frecuentes*\n\n1. ¿Cómo accedo a SALUTO?\n2. ¿Cómo crear una historia clínica?\n3. ¿Cómo agendar una cita?\n4. ¿Cómo generar una factura?\n5. ¿SALUTO funciona sin internet?\n6. Problemas para entrar\n\nEscribe el *número* de tu pregunta o *menu* para volver",
    { capture: true },
    async (ctx, { flowDynamic, gotoFlow, fallBack, endFlow }) => {
      const userId = ctx.from;
      const opcion = ctx.body.trim().toLowerCase();

      if (opcion === "menu" || opcion === "menú") {
        return gotoFlow(flowInicio);
      }

      if (esDespedida(opcion)) {
        cerrarSesion(userId);
        await flowDynamic("¡Perfecto! Nos vemos 👋");
        return endFlow();
      }

      const faq = preguntasFrecuentes[opcion];
      
      if (faq) {
        await flowDynamic(`*${faq.pregunta}*\n\n${faq.respuesta}\n\n---\n¿Otra pregunta? Escribe el número o *menu* para opciones`);
        actualizarSesion(userId);
        return fallBack();
      } else {
        await flowDynamic("Elige un número del 1 al 6, o escribe *menu* para volver");
        return fallBack();
      }
    }
  );

// FLOW 4: Conversación continua (cuando ya hay sesión activa)
const flowConversacion = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, fallBack, endFlow, gotoFlow }) => {
    const userId = ctx.from;

    if (!sesionActiva(userId)) {
      return endFlow();
    }

    const userMsg = ctx.body.trim();

    if (esDespedida(userMsg)) {
      cerrarSesion(userId);
      await flowDynamic("¡Listo! Para hablar de nuevo, escribe *saluto* 👋");
      return endFlow();
    }

    // Si escriben "menu" en cualquier momento
    if (userMsg.toLowerCase() === "menu" || userMsg.toLowerCase() === "menú") {
      return gotoFlow(flowInicio);
    }

    // Si están en modo soporte, continuar con IA
    if (estaEnSoporte(userId)) {
      try {
        const prompt = `${promptConsultas}\n\nUsuario: ${userMsg}`;
        const response = await chat(prompt);
        await flowDynamic(response);
        actualizarSesion(userId, true);
      } catch (error) {
        console.error("Error en IA:", error);
        await flowDynamic("Ups, algo falló. ¿Puedes repetir?");
      }
      return fallBack();
    }

    return endFlow();
  }
);

const main = async () => {
  const adapterDB = new mongoAdapter({
    dbUri: process.env.MONGO_DB_API,
    dbName: "bot-whatsapp",
    opts: {
      serverApi: {
        version: "1",
        strict: true,
        deprecationErrors: true,
      },
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
};

main();