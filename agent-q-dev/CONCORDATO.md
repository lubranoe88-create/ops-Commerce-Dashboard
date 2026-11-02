# Concordato plancia — Agent Q / Jarvis

Nota fissa (ripetere all’apertura di ogni sessione chat).

1. Agent Q di sentient-engineering è stato scelto come framework per un assistente tipo Jarvis sulla plancia.
2. L’agente deve avere un modulo ricerca che copre file locali, database e API oltre al browser use (Playwright), attivabile solo su richiesta dell’utente.
3. Le chiavi API sono già presenti nella plancia e vanno riutilizzate, mai hardcodate.
4. L’utente è da tablet per ora (computer tra un paio di settimane/mesi), quindi l’interfaccia deve funzionare da browser tablet.
5. La ricerca locale va in sandbox con permessi limitati.
6. Non ci sono riferimenti verificati a usi istituzionali o intelligence nella repo ufficiale; il paper riporta ~95% successi su task web con Llama-3 70B.
