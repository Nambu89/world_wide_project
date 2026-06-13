# feedback: zero-key first

**Regla:** prioriza fuentes de datos **sin API key**. Las keys son opcionales y deben **degradar con gracia**, nunca romper la app.

**Por qué:** worldmonitor marketea zero-key pero muchas features flagship exigen keys (Finnhub/FRED/EIA/ACLED) y muestran "credentials required" en vez de degradar. Evitamos esa fragilidad: el MVP debe funcionar sin ninguna key.

**Cómo aplicar:** conectores keyless primero (markets Yahoo/CoinGecko, GDELT, RSS, USGS, country-risk). Si una fuente necesita key, el conector retorna vacío gracioso cuando falta y la UI lo indica. Selección de fuentes: preferir endpoints documentados+keyless; tratar scraping/endpoints no documentados (Yahoo v8/v6, Telegram) como degradables y aislados.
