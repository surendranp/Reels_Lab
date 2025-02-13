const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generateContent = async (inputType, userInput) => {
  const prompt =
    inputType === "keywords"
      ? `Generate 5 line content pieces for these keywords without point numbers and bullet points, each lines have a 14 words only: ${userInput}`
      : `Split this script into small readable segments:\n${userInput}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
  });

  return completion.choices[0]?.message?.content;
};

module.exports = { generateContent };
