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
// const MockAdapter = require("@bot-whatsapp/database/mock");
const mongoAdapter = require("@bot-whatsapp/database/mongo");
const { chat } = require("./ai");
const path = require("path");
const fs = require("fs");

const pathConsultas = path.join(__dirname, "mensajes", "promptConsultas.txt");
const promptConsultas = fs.readFileSync(pathConsultas, "utf-8");

const despedidas = [
  "gracias",
  "muchas gracias",
  "adiós",
  "hasta luego",
  "chao",
  "nos vemos",
  "bye",
  "no",
];

const flowConsultasSaluto = addKeyword(EVENTS.WELCOME)
  .addAnswer(
    "🙌 Bienvenido al bot de *SALUTO*. Estoy aquí para ayudarte con soporte o información.\n\nEscribe tu duda:",
    { capture: true },
    async (ctx, { flowDynamic }) => {
      const userMsg = ctx.body.trim().toLowerCase();

      if (despedidas.some((palabra) => userMsg.includes(palabra))) {
        await flowDynamic(
          "👋 ¡Gracias por contactarte con SALUTO! Que tengas un excelente día."
        );
        return;
      }

      const prompt = `${promptConsultas}\nEl usuario pregunta: ${ctx.body}\nPor favor, responde de forma breve y útil.`;
      const response = await chat(prompt);

      await flowDynamic(response);
      await flowDynamic("¿Tienes otra duda?");
    }
  )
  .addAnswer("", { capture: true }, async (ctx, { flowDynamic }) => {
    const userMsg = ctx.body.trim().toLowerCase();

    if (despedidas.some((palabra) => userMsg.includes(palabra))) {
      await flowDynamic(
        "👋 ¡Gracias por contactarte con SALUTO! ¡Hasta luego!"
      );
      return;
    }

    const prompt = `${promptConsultas}\nUsuario: ${ctx.body}\nResponde de forma breve y natural.`;
    const response = await chat(prompt);

    await flowDynamic(response);
    await flowDynamic("¿Deseas preguntar algo más?");
  });

const main = async () => {
  const adapterDB = new mongoAdapter({
    dbUri: process.env.MONGO_DB_API,
    dbName: "bot-whatsapp",
  });
  const adapterFlow = createFlow([flowConsultasSaluto]);
  const adapterProvider = createProvider(BaileysProvider);

  createBot({
    flow: adapterFlow,
    provider: adapterProvider,
    database: adapterDB,
  });

  QRPortalWeb();
};

main();
