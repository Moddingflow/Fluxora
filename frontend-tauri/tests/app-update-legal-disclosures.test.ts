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
        'public ip address',
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
        'öffentliche ip-adresse',
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
        'публичный ip-адрес',
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
});
