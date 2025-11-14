const { CohereClient } = require("cohere-ai");
const dotenv = require("dotenv");

dotenv.config();

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

async function chat(prompt) {
  try {
    const response = await cohere.chat({
      model: "command-a-03-2025",
      message: prompt,
    });

    return response.text.trim();
  } catch (cohereError) {
    console.error("❌ Error al conectar con Cohere:", cohereError);
    return "❌ No se pudo obtener respuesta del modelo.";
  }
}

module.exports = { chat };