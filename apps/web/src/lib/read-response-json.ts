export async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error('Pusta odpowiedź API — sprawdź, czy serwer API działa.');
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Niepoprawna odpowiedź API (oczekiwano JSON).');
  }
}
