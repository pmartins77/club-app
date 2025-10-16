export default function handler(req, res) {
  res.status(200).json({
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    node: process.version
  });
}
