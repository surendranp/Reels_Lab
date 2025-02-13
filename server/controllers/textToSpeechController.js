const axios = require("axios");
require("dotenv").config();

const convertTextToSpeech = async (text, outputFilePath) => {
  try {
    // Replace with your TTS API service (e.g., ElevenLabs, Google, AWS)
    const TTS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";
    const API_KEY = process.env.TTS_API_KEY;

    const response = await axios.post(
      TTS_API_URL,
      {
        text,
        voice_id: "onwK4e9ZLuTAKqWW03F9", // Replace with desired voice
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
        },
        responseType: "arraybuffer",
      }
    );

    fs.writeFileSync(outputFilePath, response.data);
    console.log(`Voiceover saved to ${outputFilePath}`);
  } catch (error) {
    console.error("Error during text-to-speech conversion:", error);
    throw new Error("Failed to convert text to speech.");
  }
};

module.exports = { convertTextToSpeech };
