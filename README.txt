Asignador de Tablets — PWA (Vanilla JS)
=======================================

Archivos:
- index.html               → UI + estilos + referencia a app.js
- app.js                   → Lógica (IndexedDB, CRUD, asignaciones, export CSV, escáner opcional, Firebase opcional)
- sw.js                    → Service Worker para cache offline (solo en https/localhost)
- manifest.webmanifest     → Metadatos de PWA (para instalar la app)

Cómo ejecutar (rápido):
1) Copia estos 4 archivos a una misma carpeta.
2) Abre index.html en Chrome/Edge.
3) (Opcional) Para usar cámara o instalar como app: sirve por https o localhost (por ejemplo con la extensión “Live Server” de VS Code).

Notas:
- Todo funciona offline gracias a IndexedDB.
- Para multiusuario, pega tu config de Firebase en Ajustes y pulsa “Activar Firestore”.
- Exporta CSV desde la pestaña Asignar.
