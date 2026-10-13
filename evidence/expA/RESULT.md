# Exp. A — SendMessage nativo (2026-10-12, Claude Code 2.1.296)
Agentes: general-purpose, lanzados en segundo plano con la tool Agent (la tool no expone parámetro `name`; direccionados por agentId).
- Envío al agente alpha a mitad de ejecución: "Message queued for delivery ... at its next tool round" (aceptado).
- Recepción: alpha.log 19:12:19 "RECIBIDO" (~10 s después del paso 1) -> recibido en su siguiente ronda de herramientas.
- Aplicación: pasos 2-6 de alpha con "CAMBIO"; beta sin cambios (pasos 1-6 normales).
- Contexto conservado: alpha informó ZORRO-17 al final (sin recrearlo).
- Respuesta al maestro: llegó al terminar (hand-back), no como respuesta intermedia.
No probado: foreground, fork, respuesta intermedia, agentes con nombre.
