# Realm Keycloak

`realm-export.json` импортируется через Docker Compose.
`keycloak-results-export.json` содержит итоговый экспорт realm.

LDAP bind password в committed realm export задан как placeholder
`change-me-ldap-bind-password`; локальный Docker Compose использует тот же
placeholder для OpenLDAP, чтобы импорт работал без ручной подстановки.

Клиент `bionicpro-auth` настроен как confidential client и работает через
Authorization Code Flow with PKCE `S256`. Браузер получает только сессионную
cookie `bionicpro_sid`; `access_token` и `refresh_token` остаются в
`bionicpro-auth`.

Яндекс ID подключён через Keycloak Identity Brokering. Keycloak обращается к
локальному OIDC-адаптеру в `bionicpro-auth`, а адаптер вызывает OAuth 2.0
Яндекса и API профиля. Для запроса профиля нужен заголовок:
`Authorization: OAuth <token>`.

Для реального Яндекс ID нужно OAuth 2.0-приложение с такими параметрами:

- Callback URL: `http://localhost:8000/yandex/callback`
- Scopes: `login:info`, `login:email`

Client ID и secret передаются через переменные окружения:

- `YANDEX_CLIENT_ID`
- `YANDEX_CLIENT_SECRET`

Реальные секреты Яндекс ID не хранятся в realm export. Keycloak использует
локальные endpoints адаптера:

- Authorization URL: `http://localhost:8000/yandex/authorize`
- Token URL: `http://bionicpro-auth:8000/yandex/token`
- UserInfo URL: `http://bionicpro-auth:8000/yandex/userinfo`
- JWKS URL: `http://bionicpro-auth:8000/yandex/jwks`

Адаптер подписывает `id_token` через RS256. В Docker Compose приватный ключ
хранится в named volume и задаётся через `YANDEX_BROKER_PRIVATE_KEY_FILE`, чтобы
перезапуск контейнера не ломал проверку подписи в Keycloak.
