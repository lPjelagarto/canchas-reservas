function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = { type: 'error', text: 'Debes iniciar sesión para continuar.' };
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.flash = { type: 'error', text: 'Debes iniciar sesión para continuar.' };
      return res.redirect('/login');
    }
    if (req.session.user.role !== role) {
      return res
        .status(403)
        .render('error', { title: 'Acceso denegado', message: 'No tienes permisos para esta sección.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
