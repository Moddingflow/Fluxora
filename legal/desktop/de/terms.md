# Nutzungsbedingungen

Gültig ab: 2. August 2026

Prüfstatus: Diese Bedingungen sind ein technischer Entwurf für die Freigabe und keine abschließende Rechtsberatung. Eine öffentliche Veröffentlichung ist gesperrt, bis der Betreiber die Tatsachen genehmigt und ein qualifizierter deutscher Rechtsanwalt die deutsche Originalfassung sowie die englische und russische Übersetzung geprüft hat.

## 1. Betreiber und Annahme

Fluxora wird bereitgestellt von Valerii Semenov / Валерий Семёнов, c/o Autorenglück #61208, Albert-Einstein-Straße 47, 02977 Hoyerswerda, Deutschland.

Mit Installation oder Nutzung von Fluxora nehmen Sie diese Nutzungsbedingungen an. Setup fragt getrennt nach der Annahme dieser Bedingungen und der Bestätigung, dass die Datenschutzerklärung gelesen wurde. Die Kenntnisnahme der Datenschutzerklärung ist keine Einwilligung in sämtliche Datenverarbeitungen.

Wenn Sie diese Bedingungen nicht annehmen, setzen Sie die Installation nicht fort.

## 2. Lizenz und erlaubte Nutzung

Vorbehaltlich dieser Bedingungen und anwendbarer Drittanbieterlizenzen erhalten Sie ein persönliches, nicht ausschließliches, nicht übertragbares und widerrufliches Recht, Fluxora für rechtmäßiges Mod-Management und damit verbundene Desktopaufgaben zu installieren und zu verwenden. Sie dürfen Signatur- oder Integritätskontrollen nicht umgehen, keine offizielle Distribution vortäuschen, Fluxora nicht zur Verletzung von Rechten Dritter verwenden und verbundene Dienste nicht entgegen deren Bedingungen nutzen.

Rechte an Spielen, Mods, Archiven, Marken, APIs, Modellen, Schriften, Icons und sonstigem Drittmaterial verbleiben bei den jeweiligen Rechteinhabern. Die technische Downloadmöglichkeit eines Mods erteilt keine Erlaubnis zu seiner Weitergabe oder Änderung.

## 3. Offizielle Installation und keine portable Distribution

Der unterstützte öffentliche Windows-Installer ist `FluxoraSetup.exe` aus dem offiziellen Fluxora-Releasekanal. Setup installiert benutzerbezogen, normalerweise unter `%LOCALAPPDATA%\Programs\Fluxora`, ohne zwingende Rechteerhöhung. Es kann standardmäßig eine Desktopverknüpfung erstellen und `moddingflow://` für den aktuellen Benutzer registrieren. Reparatur und Entfernung ändern Registrierung und Verknüpfungen nur nach Eigentumsprüfung.

Fluxora wird nicht als portabler Programmordner oder portables Archiv verteilt. Lose Payload-Dateien, Staging-Verzeichnisse, Buildausgaben, Updatepakete, Manifeste, Signaturen und Inventare sind keine alternativen Endnutzer-Installer. Beziehen Sie die Anwendung nur über den offiziellen Kanal und führen Sie interne Updatedaten nicht als Programm aus.

## 4. Voraussetzung WebView2

Die Windows-Oberfläche von Fluxora benötigt Microsoft Edge WebView2. Ist eine geeignete Runtime bereits vorhanden, kann Setup Fluxora offline installieren. Fehlt sie, erklärt Setup die Abhängigkeit vor Erstellung der Weboberfläche und startet erst nach Ihrer Bestätigung den eingebetteten offiziellen Microsoft Evergreen Bootstrapper. Dieser benötigt eine Onlineverbindung zu Microsoft und unterliegt den Microsoft-Bedingungen. Bei Ablehnung oder fehlendem Netzwerk kann Setup erst fortfahren, nachdem WebView2 auf anderem unterstütztem Weg installiert wurde.

## 5. Installationstransaktionen, Reparatur und Wiederherstellung

Setup prüft Zielpfad, freien Speicher, Paketintegrität und Eigentümerschaft einer vorhandenen Installation. Mit Installieren nach Annahme dieser Bedingungen und Kenntnisnahme der Datenschutzerklärung gestatten Sie einen Vorgang, der das eingebettete Paket installiert, repariert oder aktualisiert und die Installation anschließend automatisch auf die neueste neuere signierte stabile Version bringt, soweit vorhanden. Eine von Setup stammende Installation hat zunächst keinen signierten Update-Inventarbeleg und verwendet deshalb für dieses erste Update nach Setup ausschließlich das signierte Vollpaket; Downgrade und Delta-Auswahl sind dabei ausgeschlossen. Setup und Updater verwenden Staging, atomaren Commit, dauerhaften Eigentumsnachweis, Wiederherstellungsmarker, Zustandsbewährung und Rollback. Ein Abbruch ist nur vor dem Commit der Updater-Übergabe möglich. Danach sind Schließen und Abbruch blockiert, bis die Transaktion abgeschlossen oder wiederhergestellt ist. Schlagen Erkennung oder Download fehl, startet Setup die erfolgreich installierte eingebettete Version; schlägt die Anwendung fehl, führt der native Ablauf einen Rollback aus und startet die sicher wiederhergestellte Vorversion.

Verändern Sie keine Transaktions-, Backup-, Watchdog-, Beleg- oder Recovery-Dateien, solange Setup oder Updater läuft. Stromausfall, Laufwerksfehler, Sicherheitssoftware, unzureichende Rechte oder manuelle Dateiänderungen können eine Wiederherstellung dennoch verhindern.

## 6. Aktualisierungen

Fluxora prüft festgelegte öffentliche GitHub-Releaseassets beim Anwendungsstart, alle 15 Minuten während das primäre Fenster läuft und beim erneuten Fokussieren dieses Fensters nach mindestens fünf Minuten. Eine dauerhafte öffentliche Supabase-WebSocket-Verbindung kann früher ein Releasesignal liefern; dieses Signal ist jedoch keine Update-Autorität und muss über das signierte GitHub-Manifest bestätigt werden. Die Hintergrund-Erkennung stellt nur fest, ob eine neuere signierte Version vorhanden ist; Paketdownload, Installation, Beendigung und Neustart beginnen erst nach Auswahl der Update-Aktion. In Setup umfasst Installieren ausdrücklich die automatische signierte Prüfung nach der Installation und, wenn eine neuere Version vorhanden ist, Vollpaketdownload, Übergabe an den isolierten Updater, Installation, Zustandsprüfung und Neustart.

Aktualisierungen können signierte Vollpakete oder Deltas für eine exakt passende Vorversion sein. Ein Vollpaket wird verwendet, wenn kein sicheres Delta verfügbar ist oder die Installation keinen geeigneten Beleg besitzt. Fluxora prüft das signierte Manifest, den Pakethash und das Zieldateiinventar vor dem Commit. Der Updater wartet auf die Anwendung, verwendet eine isolierte Laufzeit, staged Änderungen, startet die neue Version in einer Bewährungsphase, verlangt eine frische Zustandsbestätigung und finalisiert oder rollt zurück.

Installieren Sie Sicherheits- und Kompatibilitätsupdates innerhalb eines angemessenen Zeitraums. Nach § 327f BGB müssen erforderliche Aktualisierungen einschließlich Sicherheitsupdates gegebenenfalls bereitgestellt und Nutzer darüber informiert werden. Soweit die gesetzlichen Voraussetzungen vorliegen, kann die nicht rechtzeitige Installation nach ordnungsgemäßer Information die Verantwortlichkeit für einen ausschließlich durch das fehlende Update verursachten Mangel beeinflussen. Zwingende Verbraucherrechte bleiben unberührt.

Updateinfrastruktur und Drittanbieterhosting können ausfallen. Signaturprüfung reduziert Lieferkettenrisiken, ersetzt aber weder Betriebssystem-Code-Signing noch Backups oder den Bezug von Fluxora ausschließlich über den offiziellen Kanal. Aktuelle Windows-Programme und Setup werden bewusst ohne kostenpflichtiges Authenticode-Zertifikat eines vertrauenswürdigen Herausgebers verteilt; Windows kann daher eine Warnung zu unbekanntem Herausgeber oder Reputation anzeigen.

## 7. Verantwortung der Nutzer

Vor Mod-Installation, Dateibereitstellung, Managerimport, Load-Order-Änderung, Toolstart, Update oder AI-gestützter Änderung:

- prüfen Sie Spiel, Profil, Pfade, Mod-Berechtigungen, Abhängigkeiten und geplante Handlung;
- halten Sie getestete Backups von Spielständen, Projekten, Profilen, Konfiguration und nicht ersetzbaren Archiven;
- schließen oder pausieren Sie Tools, die dieselben Dateien sperren können;
- prüfen Sie Warnungen, Vorgangszusammenfassungen und Wiederherstellungshinweise;
- beachten Sie Spiel-, Plattform-, API-, Urheber-, Lizenz- und Community-Regeln.

Der geschützte Fluxora-`Downloads`-Baum und die Protokolle sind Benutzerdaten und vom Austausch des Anwendungspayloads ausgeschlossen. Dieser Schutz ersetzt keine Backups.

## 8. Verbundene Dienste und Downloads

ModdingFlow, Nexus Mods, GitHub, Microsoft, Google/Gemini, Downloadhosts, Spielehersteller und von Ihnen geöffnete Webseiten sind unabhängige Dritte mit eigener Verfügbarkeit, Bedingungen, Datenschutzpraxis, Quoten, Moderation und Inhaltsentscheidung. Fluxora kann deren Daten, Links, Kennungen, Dateien oder Antworten nicht garantieren.

Eine `moddingflow://`-Übergabe bezeichnet ein bestimmtes ModdingFlow-Artefakt. Fluxora prüft die Artefaktmetadaten einschließlich erwarteter Größe und SHA-256 und verlangt die Auswahl einer kompatiblen Instanz und eines Profils sowie Ihre ausdrückliche Bestätigung des aktuellen Installationsplans, bevor erforderliche Downloads im Manager eingereiht werden. Ein geänderter oder konfliktbehafteter Plan wird blockiert und muss erneut geprüft werden.

Downloads können verzögert, widerrufen, unvollständig, schädlich oder falsch beschrieben sein. Fluxora führt die in der aktuellen Version implementierten Integritäts- und Pfadprüfungen aus; Sie bleiben für ausgewählte Inhalte, Berechtigungen und das resultierende Spiel verantwortlich.

## 9. AI und lokale Spracheingabe

AI-Ausgaben können falsch, unvollständig, veraltet oder unsicher sein. Öffentliche Webinhalte, Modellausgaben und abgerufene Dateien sind nicht vertrauenswürdige Eingaben. Native Richtlinienprüfungen, typisierte Capabilities, Bestätigungen, Transaktionsgrenzen und Rollback reduzieren Risiken, machen die Ausgabe aber nicht verbindlich. Prüfen Sie Diffs und Ergebnisse.

Spracherkennung erfolgt lokal mit eingebetteten Modellen. Nur ein von Ihnen abgesendetes Transkript gelangt in den AI-Anfragefluss. Prüfen Sie es vor dem Senden, insbesondere wenn daraus eine vorgeschlagene Handlung entstehen kann.

Übermitteln Sie keine Geheimnisse, rechtswidrigen Inhalte oder nicht erforderlichen persönlichen oder vertraulichen Daten. Sie müssen zur Verarbeitung und Übermittlung von Drittinhalten berechtigt sein.

## 10. Verfügbarkeit und Änderungen

Fluxora kann korrigiert, abgesichert, geändert, ausgesetzt oder eingestellt werden. Funktionen und Integrationen können sich ändern, wenn Betriebssysteme, Spiele, Modformate oder Drittanbieter-APIs wechseln. Eine unterbrechungsfreie Verfügbarkeit oder Kompatibilität mit jedem Tool, Mod, jeder Spielversion oder jedem Gerät wird nicht zugesagt.

Wesentliche Änderungen dieser Bedingungen werden durch ein neues Gültigkeitsdatum und, soweit erforderlich, einen geeigneten Hinweis kenntlich gemacht.

## 11. Gewährleistung und Haftung

Fluxora wird unter Beachtung zwingenden Rechts bereitgestellt. Nichts in diesen Bedingungen schließt Haftung für Vorsatz, grobe Fahrlässigkeit, Schäden an Leben, Körper oder Gesundheit, zwingende Produkthaftung, arglistig verschwiegene Mängel, ausdrücklich übernommene Garantien oder sonst nicht abdingbare Haftung aus oder begrenzt sie.

Bei einfacher Fahrlässigkeit ist die Haftung, soweit gesetzlich zulässig, auf die Verletzung einer wesentlichen Vertragspflicht und den vertragstypisch vorhersehbaren Schaden begrenzt. Zwingende deutsche und europäische Verbraucherrechte, insbesondere zu digitalen Produkten und erforderlichen Aktualisierungen, bleiben unberührt.

## 12. Beendigung und Entfernung

Sie können Fluxora jederzeit nicht mehr verwenden und deinstallieren. Die Entfernung der Anwendung löscht möglicherweise keine Projekte, Downloads, Protokolle, Zugangsdaten, Backups oder außerhalb des Installationsverzeichnisses gespeicherten Daten. Nutzen Sie die verfügbaren Kontrollen und prüfen Sie die dokumentierten lokalen Speicherorte.

Das Nutzungsrecht kann bei wesentlichem Verstoß beendet werden. Bestimmungen, die ihrer Natur nach fortgelten, insbesondere zu geistigem Eigentum, Haftung und Streitigkeiten, bleiben bestehen.

## 13. Anwendbares Recht und Verbraucherstreitbeilegung

Es gilt deutsches Recht, ohne Verbrauchern den zwingenden Schutz des Rechts ihres gewöhnlichen Aufenthalts zu entziehen. Der Gerichtsstand richtet sich nach zwingendem Recht.

Der Betreiber ist weder verpflichtet noch bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen. Die frühere europäische Online-Streitbeilegungsplattform wurde am 20. Juli 2025 eingestellt; deshalb wird sie hier nicht verlinkt.

## 14. Kontakt

Allgemeine und rechtliche Anfragen:

E-Mail: moddingflow@gmail.com<br>
Rechtlicher Kontakt: legal@moddingflow.com

## 15. Maßgebliche Prüfquellen

- BGB § 327f: https://www.gesetze-im-internet.de/bgb/__327f.html
- VSBG § 36: https://www.gesetze-im-internet.de/vsbg/__36.html
- Mitteilung der Europäischen Kommission über die Einstellung der früheren Plattform: https://consumer-redress.ec.europa.eu/site-relocation_en
