export function securityHeaders(_req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), screen-wake-lock=(self)');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'No encontrado' });
}
