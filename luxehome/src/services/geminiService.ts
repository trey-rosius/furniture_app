import { GoogleGenAI, Type } from "@google/genai";

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getDesignAdvice(message: string, history: { role: 'user' | 'model', parts: { text: string }[] }[]) {
  const model = "gemini-3-flash-preview";
  const chat = ai.chats.create({
    model,
    config: {
      systemInstruction: "You are LuxeHome's AI Design Agent. You are an expert in architectural minimalist furniture and interior design. Your goal is to help users find the perfect pieces for their home. Be elegant, professional, and helpful. If the user asks for recommendations, suggest pieces that fit the 'architectural minimalist' aesthetic.",
    },
  });

  // We don't use the history directly in sendMessage, but we can initialize the chat with it if needed.
  // For simplicity, we'll just send the message.
  const response = await chat.sendMessage({ message });
  return response.text;
}

export async function analyzeFurnitureImage(base64Image: string) {
  const model = "gemini-3-flash-preview";
  const prompt = "Analyze this furniture piece or interior scene. Identify the style, materials, and key design elements. Then, suggest 5 similar architectural minimalist furniture items that would match this aesthetic. Return the results in JSON format with 'analysis' (string) and 'recommendations' (array of objects with 'name', 'material', 'price', 'matchPercentage').";

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: { type: Type.STRING },
          recommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                material: { type: Type.STRING },
                price: { type: Type.STRING },
                matchPercentage: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text || "{}");
}
