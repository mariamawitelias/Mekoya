import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
};

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  if (!apiKey) throw new Error('GEMINI_API_KEY is empty in .env');

  const client = new GoogleGenAI({ apiKey });
  const filePath = process.argv[2];

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: filePath
        ? 'Describe this file in one short sentence. Reply as JSON: {"description": string}'
        : 'Reply with exactly this JSON and nothing else: {"ok":true}',
    },
  ];

  if (filePath) {
    const mimeType = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    if (!mimeType) throw new Error('Use a .jpg, .png or .pdf file');
    parts.push({ inlineData: { mimeType, data: readFileSync(filePath).toString('base64') } });
  }

  const started = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  });

  console.log(`model:    ${model}`);
  console.log(`time:     ${Date.now() - started} ms`);
  console.log(`response: ${response.text}`);
}

main().catch((error: unknown) => {
  console.error('Gemini call failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});