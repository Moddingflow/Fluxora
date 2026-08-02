import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Locale = 'en' | 'de' | 'ru';

const readLegal = (locale: Locale, document: 'privacy' | 'terms'): string =>
  readFileSync(
    new URL(
      `../../legal/desktop/${locale}/${document}.md`,
      import.meta.url
    ),
    'utf8'
  ).toLowerCase();

describe('automatic application update legal disclosure parity', () => {
  it.each([
    [
      'en',
      [
        'github releases',
        'persistent supabase websocket',
        'public release metadata',
        'public ip address',
        'tls/websocket protocol metadata',
        'no telemetry, account, project, mod, archive, or ai data',
        'github startup, focus, and 15-minute polling remains the fallback',
        'etag',
        'last-modified',
        'two further automatic background attempts',
        'setup automatically downloads the signed full package',
        'only after you choose the in-app update action',
        'watchdog',
        'runonce recovery'
      ]
    ],
    [
      'de',
      [
        'github releases',
        'dauerhafte supabase-websocket-verbindung',
        'öffentlichen release-metadaten',
        'öffentliche ip-adresse',
        'tls-/websocket-protokollmetadaten',
        'keine telemetrie-, konto-, projekt-, mod-, archiv- oder ai-daten',
        'github-abfragen beim start, fokus und im 15-minuten-intervall bleiben der fallback',
        'etag',
        'last-modified',
        'zwei weitere automatische hintergrundversuche',
        'lädt setup automatisch das signierte vollpaket',
        'erst, wenn sie die update-aktion in der anwendung auswählen',
        'watchdog',
        'runonce-wiederherstellung'
      ]
    ],
    [
      'ru',
      [
        'github releases',
        'постоянное websocket-соединение с supabase',
        'публичные метаданные релиза',
        'публичный ip-адрес',
        'метаданные протоколов tls/websocket',
        'не содержит telemetry, данных аккаунта, проекта, мода, архива или ai',
        'github polling при запуске, возврате фокуса и каждые 15 минут остаётся fallback',
        'etag',
        'last-modified',
        'двух дополнительных автоматических фоновых попыток',
        'setup автоматически загружает подписанный full package',
        'после выбора действия обновления внутри приложения',
        'watchdog',
        'runonce recovery'
      ]
    ]
  ] as const)('%s privacy text discloses automatic discovery and recovery', (locale, required) => {
    const privacy = readLegal(locale, 'privacy');

    for (const text of required) {
      expect(privacy).toContain(text);
    }
  });

  it.each([
    [
      'en',
      'github release assets',
      'signed manifest',
      'only after you choose the available update action',
      'install action expressly includes the automatic post-install signed check',
      'signed full package'
    ],
    [
      'de',
      'github-releaseassets',
      'signierte manifest',
      'erst nach auswahl der update-aktion',
      'in setup umfasst installieren ausdrücklich die automatische signierte prüfung',
      'signierte vollpaket'
    ],
    [
      'ru',
      'github release assets',
      'signed manifest',
      'только после выбора действия обновления',
      'в setup действие «установить» прямо включает автоматическую подписанную проверку',
      'подписанный full package'
    ]
  ] as const)(
    '%s terms distinguish automatic Setup update from user-triggered in-app update',
    (locale, releaseAssetsText, manifestText, userActionText, setupActionText, fullPackageText) => {
      const terms = readLegal(locale, 'terms');

      for (const required of [
        releaseAssetsText,
        manifestText,
        userActionText,
        setupActionText,
        fullPackageText,
        'downgrade',
        'delta',
        'backup',
        'rollback',
        'downloads'
      ]) {
        expect(terms).toContain(required);
      }
    }
  );

  it.each([
    ['en', 'request a check in settings', 'manual settings action'],
    ['de', 'in den einstellungen', 'manuelle aktion in den einstellungen'],
    ['ru', 'в настройках', 'вручную из настроек']
  ] as const)('%s documents no longer advertise a manual Settings check', (
    locale,
    privacyManualText,
    secondaryPrivacyManualText
  ) => {
    const privacy = readLegal(locale, 'privacy');
    const terms = readLegal(locale, 'terms');

    expect(privacy).not.toContain(privacyManualText);
    expect(privacy).not.toContain(secondaryPrivacyManualText);
    expect(terms).not.toContain(privacyManualText);
  });
});
