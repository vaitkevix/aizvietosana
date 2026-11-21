-- SH | Grafika darbi: Logu mazgāšana (logi), Dārzniecība (darz), Pazemes stāvvietas (stav), Sniega tīrīšana (sniegs). © VAITKEVIX, SIA
-- Zāles pļaušanai paliek savas pl_* tabulas.
CREATE TABLE IF NOT EXISTS sv_obj (svc TEXT NOT NULL, anorm TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0, intervals INTEGER NOT NULL DEFAULT 0, aktivs INTEGER NOT NULL DEFAULT 1,
  brigade TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', veidi TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL, PRIMARY KEY (svc, anorm));
CREATE TABLE IF NOT EXISTS sv_visit (id TEXT PRIMARY KEY, svc TEXT NOT NULL, anorm TEXT NOT NULL, adrese TEXT NOT NULL, datums TEXT NOT NULL, statuss TEXT NOT NULL DEFAULT 'plan',
  prio INTEGER NOT NULL DEFAULT 0, brigade TEXT NOT NULL DEFAULT '', izpilditajs TEXT NOT NULL DEFAULT '', laiks TEXT NOT NULL DEFAULT '', sakums TEXT NOT NULL DEFAULT '',
  foto TEXT NOT NULL DEFAULT '', iemesls TEXT NOT NULL DEFAULT '', piezime TEXT NOT NULL DEFAULT '', parcelts INTEGER NOT NULL DEFAULT 0, pazinots TEXT NOT NULL DEFAULT '',
  izs TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL DEFAULT 0, izveidots TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sv_visit_d ON sv_visit (svc, datums);
CREATE INDEX IF NOT EXISTS sv_visit_a ON sv_visit (svc, anorm);
CREATE INDEX IF NOT EXISTS sv_visit_i ON sv_visit (izs);
-- Sniega izsaukumi: gaida (vadītājam jāapstiprina) | aktivs | beigts | atcelts
CREATE TABLE IF NOT EXISTS sv_call (id TEXT PRIMARY KEY, svc TEXT NOT NULL, datums TEXT NOT NULL, statuss TEXT NOT NULL DEFAULT 'gaida', cm REAL NOT NULL DEFAULT 0,
  avots TEXT NOT NULL DEFAULT '', izveidots TEXT NOT NULL DEFAULT '', apstiprinaja TEXT NOT NULL DEFAULT '', beigts TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sv_call_d ON sv_call (svc, datums);
CREATE TABLE IF NOT EXISTS sv_log (id INTEGER PRIMARY KEY AUTOINCREMENT, svc TEXT NOT NULL, laiks TEXT NOT NULL, teksts TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sv_log_s ON sv_log (svc, id);
