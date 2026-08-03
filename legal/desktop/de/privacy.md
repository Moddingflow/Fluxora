# Datenschutzerklärung

Gültig ab: 2. August 2026

Prüfstatus: Dieses Dokument ist ein technischer Entwurf für die Freigabe und keine abschließende Rechtsberatung. Eine öffentliche Veröffentlichung ist gesperrt, bis der Betreiber die Tatsachen bestätigt und ein qualifizierter deutscher Rechtsanwalt die deutsche Originalfassung sowie die englische und russische Übersetzung geprüft hat.

## 1. Verantwortlicher und Kontakt

Verantwortlicher für die von Fluxora durchgeführte Verarbeitung ist:

Valerii Semenov / Валерий Семёнов<br>
c/o Autorenglück #61208<br>
Albert-Einstein-Straße 47<br>
02977 Hoyerswerda<br>
Deutschland

E-Mail: moddingflow@gmail.com<br>
Rechtlicher Kontakt: legal@moddingflow.com

## 2. Geltungsbereich und Produktkonzept

Diese Erklärung gilt für Fluxora Setup, Fluxora Updater, die Fluxora-Desktopanwendung, ihre native Rust/Tauri-Shell, den nativen C++-Kern und die nachfolgend beschriebenen optionalen Online-Integrationen.

Fluxora ist in erster Linie als lokale Desktopanwendung konzipiert. Das Produkt enthält keine Werbeanalysen, kein verhaltensbezogenes Tracking und keinen automatischen Upload von Protokollen oder Absturzberichten. Lokaler Anwendungszustand wird nicht allein deshalb an den Betreiber übermittelt, weil er auf dem Gerät gespeichert ist. Eine Netzwerkverarbeitung erfolgt bei der automatischen Release-Erkennung und wenn Sie eine weitere Online-Funktion anfordern.

Die Windows-Oberfläche nutzt die auf dem System installierte Microsoft Edge WebView2 Runtime. Fluxora liefert keinen separaten portablen Browser aus. Die Oberfläche ist auf die Produkt-UI beschränkt und erfasst keinen allgemeinen Browserverlauf.

## 3. Setup, WebView2, Installation, Reparatur und Entfernung

Setup verarbeitet Systemgebietsschema, gewählte UI-Sprache, Installationspfad, Ergebnis der Speicherplatzprüfung, Verknüpfungsoption, Annahme der Nutzungsbedingungen, Bestätigung der Kenntnisnahme dieser Datenschutzerklärung, Eigentumsinformationen einer vorhandenen Installation, Fortschritt, stabile Fehlercodes und eine Vorgangskennung. Mit Installieren gestatten Sie Setup, das eingebettete Paket zu installieren oder zu reparieren und anschließend automatisch die neueste signierte stabile Fluxora-Version zu prüfen sowie, falls vorhanden, herunterzuladen und anzuwenden. Setup erstellt eine benutzerbezogene Installation, normalerweise unter `%LOCALAPPDATA%\Programs\Fluxora`, einen dauerhaften Eigentumsnachweis, optional eine Desktopverknüpfung, die benutzerbezogene Protokollregistrierung sowie getrennte lokale Installer-, Update-, Updater- und Vorgangsprotokolle. Eine von Setup stammende Installation hat zunächst keinen signierten Update-Inventarbeleg; daher verwendet dieses erste Update nach Setup das signierte Vollpaket. Das erste erfolgreiche Update erstellt den Beleg, der spätere Deltas für eine exakt passende Version qualifiziert.

Die Annahme der Nutzungsbedingungen und die Bestätigung, dass diese Erklärung gelesen wurde, sind getrennte Handlungen. Die Kenntnisnahme der Datenschutzerklärung wird nicht als Einwilligung in sämtliche Verarbeitungen bezeichnet oder verwendet.

Fehlt WebView2, zeigt Setup vor Erstellung einer Weboberfläche eine native Erklärung. Erst nach Ihrer Bestätigung startet Setup den eingebetteten offiziellen Microsoft Edge WebView2 Evergreen Bootstrapper. Dieser verbindet sich mit Microsoft, um die zur Architektur passende Runtime abzurufen. Microsoft und seine Auslieferungsdienstleister können übliche Verbindungsdaten erhalten, insbesondere IP-Adresse, Zeitpunkt, HTTP-/TLS-Metadaten, vom Bootstrapper bereitgestellte Geräte- oder Betriebssysteminformationen und Download-Diagnosen. Fluxora fügt dieser Anfrage keine Projekt-, Mod-, Konto-, Chat-, Zugangsdaten- oder Protokollinhalte hinzu. Eine Offline-Installation von Fluxora bleibt möglich, wenn eine geeignete WebView2 Runtime bereits vorhanden ist.

Reparatur und Entfernung prüfen den dauerhaften Eigentumsnachweis, die installierte ausführbare Datei und den aktuellen Zustand der Windows-Integration sowie, soweit vorhanden, den signierten Update-Inventarbeleg, bevor Verknüpfungen oder die Registrierung von `moddingflow://` geändert werden. Staging-, Backup-, Watchdog-, RunOnce-Wiederherstellungs- und Rollback-Daten bleiben nur so lange erhalten, wie dies zum Abschluss oder zur Wiederherstellung erforderlich ist; bei einer fehlgeschlagenen Wiederherstellung können sie bis zur Fortsetzung bestehen bleiben.

## 4. Automatische Update-Erkennung, Setup-Erlaubnis und Installation in der Anwendung

Beim Start der Anwendung ruft Fluxora das öffentliche signierte Update-Manifest und dessen Signatur aus den festgelegten Fluxora-Assets bei GitHub Releases ab. Solange das primäre Anwendungsfenster läuft, wiederholt Fluxora die Prüfung alle 15 Minuten sowie beim erneuten Fokussieren dieses Fensters, wenn seit der vorherigen Prüfung mindestens fünf Minuten vergangen sind. Für diese Prüfungen ist kein GitHub-Konto erforderlich. GitHub und seine Auslieferungsdienstleister erhalten übliche Verbindungsdaten, darunter öffentliche IP-Adresse, Zeitpunkt, TLS-/HTTP-Header sowie von GitHub abgeleitete Netzwerk- und Gerätedaten. Bedingte Anfragevalidatoren (`ETag` und `Last-Modified`) und die zwei neuesten verifizierten Manifest-Cacheeinträge können lokal gespeichert werden. Schlägt die Startprüfung mit einem Fehler fehl, der einen erneuten Versuch zulässt, unternimmt Fluxora nach kurzen Wartezeiten bis zu zwei weitere automatische Hintergrundversuche; dabei werden dieselben üblichen Verbindungsdaten offengelegt. Ein fehlendes Manifest vor der ersten Veröffentlichung gilt als wiederholbarer Fehler, damit eine laufende Anwendung die erste Veröffentlichung später erkennen kann.

Der primäre Renderer hält zusätzlich eine dauerhafte Supabase-WebSocket-Verbindung zum festgelegten öffentlichen Fluxora-Releaseprojekt. Er abonniert ausschließlich Insert-/Update-Signale für stabile Releases und liest nach jeder Verbindung oder Wiederverbindung den neuesten stabilen Snapshot. Supabase und seine Infrastrukturbetreiber erhalten übliche Verbindungsdaten, darunter die öffentliche IP-Adresse, Verbindungszeiten und TLS-/WebSocket-Protokollmetadaten. Die öffentlichen Release-Metadaten enthalten nur GitHub-Releasekennung, stabilen Kanal, Version, Tag und Veröffentlichungszeit; sie enthalten keine Telemetrie-, Konto-, Projekt-, Mod-, Archiv- oder AI-Daten. Ein Signal ist nicht vertrauenswürdig und darf nur dieselbe signierte GitHub-Manifestprüfung auslösen; es kann die Update-Aktion nicht selbst anzeigen. GitHub-Abfragen beim Start, Fokus und im 15-Minuten-Intervall bleiben der Fallback, wenn Realtime verzögert oder nicht verfügbar ist.

Nach erfolgreicher Installation, Reparatur oder Aktualisierung durch Setup führt Setup dieselbe signierte Prüfung als Teil der Aktion Installieren aus. Ist eine neuere stabile Version vorhanden, lädt Setup automatisch das signierte Vollpaket von GitHub Releases, speichert fortsetzbare Paket- und Prüfdaten unter `%APPDATA%\Fluxora\updates` und übergibt sie an den isolierten Updater. Scheitert die Prüfung oder der Download, startet Setup die erfolgreich installierte eingebettete Version; Fluxora kann über den automatischen Zeitplan erneut prüfen. GitHub und seine Auslieferungsdienstleister erhalten die oben beschriebenen üblichen Verbindungsmetadaten. Fluxora fügt diesen Anfragen keine Projekt-, Mod-, Archiv-, Konto-, AI-Chat-, Zugangs-, Protokoll-, Signatur- oder Autorisierungsheader-Inhalte hinzu; dieser Ablauf fügt keine Telemetrie hinzu.

Außerhalb von Setup stellt die Hintergrund-Erkennung lediglich fest, ob eine Aktualisierung verfügbar ist. Paketdownload, Installation und anschließender Neustart beginnen erst, wenn Sie die Update-Aktion in der Anwendung auswählen.

Fluxora prüft Manifest-Signatur sowie Datei- und Pakethashes. Voll- und Delta-Pakete, Manifeste, Signaturen und Inventare sind öffentliche, maschinenverarbeitete Releasedaten und keine ausführbare portable Distribution. Lokale Staging-, Backup-, Health-ACK-, Rollback- und Wiederherstellungsdaten dienen der zuverlässigen Ausführung des von Ihnen angeforderten Updates.

## 5. Lokal verarbeitete Daten

Abhängig von den genutzten Funktionen kann Fluxora lokal verarbeiten oder speichern:

- Installationspfad, installierte Version, dauerhaften Eigentumsnachweis, signierten Update-Inventarbeleg nach dessen Erstellung, Verknüpfungen, Protokolleigentum, Wiederherstellungsstatus und Vorgangskennungen;
- Sprache, Design und Anwendungseinstellungen, ausgewählte Spiel- und Toolpfade, Projekt- und Profilkonfiguration, Plugin-Reihenfolge, ausführbare Definitionen und weitere Präferenzen;
- Projektnamen, Build-Ordner, Mod-Ordner, Spielpfade, Archivmetadaten, Download-Einträge, importierte Managerdaten, lokale Dateiinventare, Hashes, Konfliktinformationen, Bereitstellungsstatus und Installationshistorie;
- Archive und Sidecar-Datensätze im geschützten `Downloads`-Baum, einschließlich Quellenkennungen, erwarteter Größe, SHA-256, fortsetzbarem Transferstatus und Installationsergebnissen;
- ModdingFlow-Profil- und Verbindungsstatus sowie Nexus-Mods-Verbindungsstatus gemäß Abschnitt 6;
- AI-Chat-Tabs, strukturierte Fortsetzungszusammenfassungen, undurchsichtige Dateireferenzen, angeforderte Textausschnitte, Tool-Ereignisse, Quellen, Run-/Vorgangskennungen und lokale Rollback-Checkpoints bei Nutzung der AI-Funktionen;
- Mikrofon-Berechtigungsstatus, temporäre Audiopuffer, lokale Sprachmodelle und das Ergebnis der lokalen Spracherkennung;
- getrennte Installer-, Updater-, UI-, Rust-Shell-/Bridge-, native Core-, Vorgangs- und Crash-Protokolle. Sie können Zeitstempel, Vorgangskennungen, Phasen, Fehler, Dateinamen, ausgewählte Pfade, Prozessinformationen und Diagnosen enthalten. Ein Pfad kann mittelbar den Namen des Windows-Kontos enthalten.

Fluxora erhebt nicht absichtlich Zahlungskartendaten, Werbekennungen, Adressbücher, genaue Standortdaten, Kamerainhalte oder den allgemeinen Browserverlauf.

## 6. Zugangsdaten und Kontointegrationen

### ModdingFlow

Wenn Sie ein ModdingFlow-Konto verbinden, nutzt Fluxora einen Authorization-Code-Flow mit PKCE im Systembrowser. Der temporäre Verifier sowie State und Nonce bestehen nur während der ausstehenden Anmeldung. Die Anwendung kann eine stabile Konto-UUID, öffentliche Profilfelder, gewährte Scopes, Token-Ablaufdaten und die für die Verbindung erforderlichen Tokens erhalten. Access- und ID-Tokens bleiben im Prozessspeicher. Das rotierende Refresh-Zugangsmittel wird unter einem Fluxora-spezifischen Ziel in der Windows-Anmeldeinformationsverwaltung gespeichert und beim Trennen oder nach serverseitiger Bestätigung seiner Ungültigkeit entfernt.

Wenn Sie den ModdingFlow-Katalog verwenden, einen Installationsplan auflösen oder einen Download anfordern, sendet Fluxora die dafür benötigten Kennungen und Parameter. Empfangen werden können Spiel-, Mod-, Versions- und Artefaktkennungen, Abhängigkeitsergebnisse, Grants, Jobkennungen, Ablaufzeit, Byte-Größe, Hashes und kurzlebige signierte Transport-URLs. Eine signierte Transport-URL wird für den angeforderten Transfer im Speicher verwendet und nicht als dauerhafte Dateiidentität behandelt.

Für ein als externe Provider-Referenz registriertes Artefakt kann ModdingFlow stattdessen eine serverseitig validierte Provider-Identität, Referenzrevision und Provider-Download-URL zurückgeben. Nach Ihrer Bestätigung des Installationsplans verbindet sich Fluxora direkt mit diesem benannten Provider oder dessen Auslieferungshost und kann übliche Verbindungsmetadaten sowie begrenzte HTTP-Range-Anfragen senden. Fluxora fügt diesem Transfer weder ein ModdingFlow-Token noch Provider-Zugangsdaten oder einen Browser-Fallback hinzu. Stabile Provider-/Referenzkennungen, erwartete Größe, SHA-256 und fortsetzbarer Transferstatus können lokal gespeichert werden; die Provider-URL bleibt ein Transportdetail im Arbeitsspeicher und ist keine dauerhafte Dateiidentität.

### Nexus Mods

Wenn Sie Nexus Mods verbinden, kann Fluxora Anzeigename, Benutzerkennung, Token-Typ und Ablaufzeit, OAuth Access-/Refresh-Tokens oder einen persönlichen API-Schlüssel verarbeiten. Dauerhaft gespeicherte Geheimnisse werden, soweit verfügbar, mit Windows-Datenschutzfunktionen geschützt. Die Anwendung sendet Spieldomain, relevante Mod-/Dateikennungen und die angeforderte API-Operation an Nexus Mods.

Fehlt einem Archiv eine stabile Quellenkennung, kann Fluxora seinen MD5-Fingerabdruck und die ausgewählte Nexus-Spieldomain senden, um eine eindeutige Mod-/Dateizuordnung anzufragen. Archivinhalte, lokaler Pfad und lokaler Dateiname werden dabei nicht gesendet. Installierte Nexus-Dateikennungen können höchstens einmal innerhalb von 24 Stunden und zusätzlich bei Ihrer manuellen Aktualisierung geprüft werden. Zurückgegebene Versions-, Verfügbarkeits-, Zeitstempel-, Quota- und Retry-Metadaten können lokal zwischengespeichert werden. 90 Tage nicht verwendete Cacheeinträge werden bereinigt.

## 7. AI, Web-Recherche und Spracheingabe

AI-Funktionen sind optional und laufen nur, wenn Sie sie verwenden. Eine Anfrage kann Ihre Nachricht, den ausgewählten Chatverlauf oder eine strukturierte Fortsetzungszusammenfassung, eine unerledigte Ziel- oder Rückfragelage, Provider-/Modellmetadaten, typisierte Capability-Erklärungen, komprimierte Metadaten des ausgewählten Builds und für die Aufgabe erforderliche begrenzte Textausschnitte enthalten. Fluxora nutzt nach Möglichkeit undurchsichtige Referenzen und relative Pfade und gewährt dem Modell keinen beliebigen Datei- oder Shellzugriff.

Verwaltete AI-Anfragen können über ein von Fluxora verwaltetes Gateway an Google/Gemini weitergeleitet werden. Wird öffentliche Web-Recherche angefordert, kann der Provider Suchanfrage und öffentliche Quellen in einer getrennten Rechercherunde verarbeiten. Providerantworten und Grounding-Quellen gelten als nicht vertrauenswürdige Eingaben und können allein keine lokale Änderung autorisieren. Provider und Unterauftragnehmer können Daten nach ihren eigenen Datenschutzhinweisen und Transfergarantien außerhalb der EU/des EWR verarbeiten.

Sprachaufnahme setzt eine ausdrückliche Nutzerhandlung und ein kurzlebiges Berechtigungsfenster voraus. Audio wird lokal durch eingebettete Whisper- und Silero-VAD-Komponenten verarbeitet. Rohes Mikrofon-Audio wird von der Spracherkennung nicht hochgeladen. Nur ein von Ihnen abgesendetes Transkript wird Bestandteil einer AI-Anfrage.

Geben Sie keine unnötigen personenbezogenen Daten, Geheimnisse, vertraulichen Informationen Dritter oder besonderen Kategorien personenbezogener Daten in AI-Prompts, importierte Texte, Dateinamen oder Supportmaterial ein.

## 8. Protokolle, Crashdaten, Cache und Speicherdauer

Protokolle und Crashdiagnosen bleiben lokal, sofern Sie sie nicht selbst teilen. Aktuelle Builds laden sie nicht automatisch hoch und erzwingen keine automatische Löschung; sie bleiben bestehen, bis Sie sie löschen, die Anwendung zurücksetzen, zugehörige Anwendungsdaten deinstallieren oder eine Systembereinigung sie entfernt.

Einstellungen, Projekte, Profile, Archive, Downloadhistorie, Sidecars und AI-Sitzungen bleiben bestehen, bis Sie das zugehörige Element löschen, die Anwendung zurücksetzen oder die betreffenden Anwendungsdaten entfernen. Das Schließen oder Löschen eines AI-Chats entfernt ihn aus dem Fluxora-AI-Sitzungsspeicher; ausdrückliche Reset-Aktionen entfernen die zugehörigen lokalen Rollback-Checkpoints. Speichergrenzen können vollständige ältere Rollback-Runs entfernen.

Nur im Arbeitsspeicher gehaltene Access- und ID-Tokens werden beim Ende des betreffenden Prozesses verworfen. Ein gespeichertes Refresh-Zugangsmittel bleibt bis zum Trennen, zur Ungültigkeit, Ersetzung, zum Reset oder zur Entfernung des entsprechenden Windows-Credentials erhalten. Update-Download-, Staging-, Backup-, Watchdog- und Recovery-Daten werden nach normalem Erfolg entfernt; unterbrochenes Wiederherstellungsmaterial kann bis zum erfolgreichen Abschluss oder bis zu seiner Entfernung nach Beendigung von Fluxora bestehen bleiben. Der Update-Manifestcache hält höchstens zwei verifizierte Einträge. 90 Tage nicht verwendete Nexus-Updatecacheeinträge werden bereinigt.

Drittanbieter bestimmen ihre serverseitige Speicherdauer selbst. Beachten Sie deren Datenschutzhinweise und Kontoeinstellungen.

## 9. Zwecke und Rechtsgrundlagen

Vorbehaltlich der Prüfung durch einen deutschen Rechtsanwalt sind folgende Rechtsgrundlagen nach Artikel 6 DSGVO vorgesehen:

- Artikel 6 Absatz 1 Buchstabe b: Installation, Betrieb, angeforderte Update-Installation, angeforderte Kontoverbindung, Downloads, AI-Antworten und weitere zur Bereitstellung der gewünschten Softwarefunktion erforderliche Vorgänge;
- Artikel 6 Absatz 1 Buchstabe f: Sicherheit, Integritätsprüfung, lokale Diagnose, Missbrauchsprävention, zuverlässige Wiederherstellung und die oben beschriebenen begrenzten automatischen Aktualisierungsprüfungen. Berechtigte Interessen sind eine sichere und kompatible Anwendung sowie Fehlerdiagnose;
- Artikel 6 Absatz 1 Buchstabe a: nur wenn ein bestimmter optionaler Ablauf ausdrücklich eine Einwilligung einholt und die davon erfasste Verarbeitung bezeichnet. Eine Einwilligung kann für die Zukunft widerrufen werden;
- Artikel 6 Absatz 1 Buchstabe c: Verarbeitung zur Erfüllung einer anwendbaren rechtlichen Verpflichtung.

Das lokale Speichern und Auslesen, das zur Bereitstellung ausdrücklich gewünschter Desktopfunktionen erforderlich ist, soll unter die Ausnahme für unbedingt erforderliche Vorgänge nach § 25 Absatz 2 TDDDG fallen. Fluxora nutzt lokalen Speicher nicht für Werbetracking. Diese Einordnung ist Teil der verpflichtenden Rechtsprüfung.

## 10. Empfänger und internationale Übermittlungen

Je nach Handlung können Empfänger sein: Microsoft für die WebView2-Auslieferung; GitHub und seine CDN-Dienstleister für Updateprüfungen und Downloads; Supabase und seine Infrastrukturprovider für den öffentlichen Release-Signal-WebSocket und Snapshot; ModdingFlow und seine Infrastrukturprovider für Konto-, Katalog-, API- und Downloadfunktionen; Nexus Mods für dessen Konto- und API-Funktionen; Google/Gemini und das verwaltete AI-Gateway für abgesendete AI-Anfragen und Web-Recherche; sowie ein Downloadhost oder eine Webseite, die Sie ausdrücklich öffnen.

Diese Anbieter handeln nach ihren eigenen Bedingungen und Datenschutzhinweisen. GitHub erklärt, Daten in den Vereinigten Staaten und weiteren Ländern zu verarbeiten und für Übermittlungen an Orte ohne Angemessenheitsbeschluss grundsätzlich anerkannte Transfermechanismen wie EU-Standardvertragsklauseln zu verwenden. Rollen, konkrete Provider und Garantien sind vor einer öffentlichen Veröffentlichung zu bestätigen.

Fluxora verkauft keine personenbezogenen Daten. Telemetrie, Protokolle, Crashdateien, Projekte, Mods oder AI-Verläufe werden nicht automatisch an den Betreiber gesendet.

## 11. Auswahlmöglichkeiten und Rechte

Sie können den WebView2-Download ablehnen, die Prüfung oder den Download nach Setup vor dem Commit der Updater-Übergabe abbrechen (danach startet die eingebettete Installation), ein verfügbares Update in der Anwendung ablehnen, optionale Konten trennen, AI- und Mikrofonfunktionen nicht verwenden oder beenden, Chats und Checkpoints löschen, Projekte und Caches entfernen, Zugangsdaten löschen und die Anwendung deinstallieren.

Soweit die DSGVO anwendbar ist und ihre Voraussetzungen erfüllt sind, können Ihnen Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch und Widerruf einer Einwilligung zustehen. Da die meisten Fluxora-Daten lokal liegen, üben Sie viele Kontrollen unmittelbar auf Ihrem Gerät aus. Für beim Verantwortlichen gespeicherte Daten oder Fragen nutzen Sie die Kontakte in Abschnitt 1.

Sie können sich bei einer zuständigen Datenschutzaufsichtsbehörde beschweren, insbesondere im EU-Mitgliedstaat Ihres gewöhnlichen Aufenthalts, Arbeitsplatzes oder des mutmaßlichen Verstoßes.

## 12. Sicherheit

Fluxora verwendet signierte Manifeste und Pakete, begrenzte native Schnittstellen, Eigentumsprüfungen, benutzerbezogenen Windows-Credential-Schutz, lokale Zugriffsrechte, erlaubte Netzwerkziele und Transaktionswiederherstellung. Keine Maßnahme beseitigt jedes Risiko. Schützen Sie Windows-Konto, Backups, Spieldaten, Zugangsdaten und Installationsverzeichnis und beziehen Sie Fluxora nur über den offiziellen Kanal.

## 13. Maßgebliche Prüfquellen

- DSGVO Artikel 13 und weitere Bestimmungen: https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679
- TDDDG § 25: https://www.gesetze-im-internet.de/ttdsg/__25.html
- GitHub General Privacy Statement: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement
- Microsoft WebView2 Distribution: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
- Tauri WebView2 Deployment: https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options

Hinweise Dritter können sich ändern. Bei Nutzung des jeweiligen Dienstes gelten dessen aktuelle Bedingungen.
