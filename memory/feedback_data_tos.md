# feedback: datos ≠ licencia del código

**Regla:** la licencia del repo (MIT/AGPL) NO cubre los datos. Cada fuente upstream tiene sus propios ToS. Verifícalos ANTES de añadir un conector.

**Por qué:** OpenSanctions es CC-BY (exige atribución); GDELT/USGS son públicos; Yahoo Finance / CoinGecko / OpenSky / Telegram-scraping son ToS-gris y/o endpoints no documentados — válidos para uso personal, frágiles para redistribución.

**Cómo aplicar:** `data-connector-dev` incluye un checklist de ToS por fuente; si el ToS no está verificado → `## ESCALATE` al PM (no añadir la fuente). Atribución CC-BY (OpenSanctions) debe aparecer en la UI. Registrar la fuente y su ToS en el design-doc del conector.
