# Архитектура BionicPRO

## Безопасность

Файл: `bionicpro-security-c4.drawio`.

`bionicpro-auth` стоит между фронтендом, Keycloak и API. Keycloak отвечает за
PKCE S256, MFA/OTP, LDAP User Federation, RBAC и Identity Brokering для
Yandex ID.

Фронтенд не получает Keycloak `access_token` и `refresh_token`. Браузер
отправляет в `bionicpro-auth` только session cookie с флагами `HttpOnly`,
`Secure` и `SameSite=Lax`. `refresh_token` хранится на сервере в зашифрованном
виде, `access_token` привязан к серверной сессии.

Yandex ID подключён через локальный OIDC-адаптер в `bionicpro-auth`. Keycloak
видит его как внешний IdP, а адаптер ходит в OAuth 2.0 Яндекса и API профиля.
Профили внешних IdP сохраняются в `Auth DB`.

## Отчёты

Файл: `bionicpro-reports-c4.drawio`.

Фронтенд вызывает `/api/reports` через `bionicpro-auth` с
`credentials: include`. `bionicpro-auth` проксирует запрос в `reports-api` и
передаёт серверный Bearer-токен.

`reports-api` проверяет JWT через Keycloak JWKS, берёт пользователя из claims и
читает ClickHouse-витрину. Тяжёлые join и агрегации в момент запроса не
выполняются. Airflow DAG `bionicpro_reports_daily` читает CRM DB и telemetry
DB, считает дневные агрегаты и обновляет `report_user_daily` и
`etl_watermarks`.

В схеме показаны пользовательский запрос отчёта, серверная сессия,
`reports-api`, OLAP-витрина и Airflow watermark.
