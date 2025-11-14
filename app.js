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

// Palabras clave para activar el bot
const palabrasClave = [
  "saluto",
  "soporte",
  "bot",
];

// Palabras de despedida que cierran la conversación
const despedidas = [
  "gracias",
  "muchas gracias",
  "adiós",
  "hasta luego",
  "chao",
  "nos vemos",
  "bye",
  "listo",
  "perfecto",
  "ok gracias",
  "ya está",
  "no necesito más",
  "cancelar",
  "salir",
];

const sesionesActivas = new Map();
const TIMEOUT_SESION = 10 * 60 * 1000;

const iniciarSesion = (userId) => {
  sesionesActivas.set(userId, {
    activa: true,
    ultimaInteraccion: Date.now(),
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

const actualizarSesion = (userId) => {
  const sesion = sesionesActivas.get(userId);
  if (sesion) {
    sesion.ultimaInteraccion = Date.now();
  }
};

const esDespedida = (texto) => {
  const textoLower = texto.toLowerCase().trim();
  return despedidas.some((palabra) => textoLower.includes(palabra));
};

// Flow principal con palabras clave
const flowInicio = addKeyword(palabrasClave).addAnswer(
  "*SALUTO*:¿En qué puedo ayudarte?",
  { capture: true },
  async (ctx, { flowDynamic, fallBack, endFlow }) => {
    const userId = ctx.from;
    iniciarSesion(userId);

    const userMsg = ctx.body.trim();

    // Si dice adiós de una vez
    if (esDespedida(userMsg)) {
      cerrarSesion(userId);
      await flowDynamic("Perfecto, cualquier cosa aquí estoy 👍");
      return endFlow();
    }

    try {
      const prompt = `${promptConsultas}\n\nUsuario pregunta: ${userMsg}`;
      const response = await chat(prompt);
      await flowDynamic(response);
    } catch (error) {
      console.error("Error en IA:", error);
      await flowDynamic(
        "Disculpa, tuve un problema técnico. Intenta de nuevo en un momento."
      );
    }

    return fallBack();
  }
);

const flowConversacion = addKeyword(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, fallBack, endFlow }) => {
    const userId = ctx.from;

    if (!sesionActiva(userId)) {
      return endFlow();
    }

    actualizarSesion(userId);
    const userMsg = ctx.body.trim();

    if (esDespedida(userMsg)) {
      cerrarSesion(userId);
      await flowDynamic(
        "Listo, fue un gusto ayudarte 👋\n\nPara volver a hablar conmigo, escribe *saluto* o *ayuda*."
      );
      return endFlow();
    }

    try {
      const prompt = `${promptConsultas}\n\nUsuario: ${userMsg}`;
      const response = await chat(prompt);
      await flowDynamic(response);
    } catch (error) {
      console.error("Error en IA:", error);
      await flowDynamic("Ups, algo falló. ¿Puedes repetir tu pregunta?");
    }

    return fallBack();
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

  const adapterFlow = createFlow([flowInicio, flowConversacion]);
  const adapterProvider = createProvider(BaileysProvider);

  createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });

  QRPortalWeb();
};

main();