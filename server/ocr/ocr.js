import { createWorker } from "tesseract.js";

/**
 * OCR for printed prescriptions / pharmacy bills.
 * For handwritten scripts, you typically need a Vision/LLM service.
 */
export async function ocrImageBytes(imageBytes) {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageBytes);
    return (data?.text || "").trim();
  } finally {
    await worker.terminate();
  }
}

