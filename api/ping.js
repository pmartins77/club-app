export default function handler(req, res) {
  res.status(200).json({ ok: true, path: req.url, ts: new Date().toISOString() });
}
