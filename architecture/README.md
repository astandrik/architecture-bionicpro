# Архитектура BionicPRO

## Безопасность

Файл: `bionicpro-security-c4.drawio`.

`bionicpro-auth` стоит между фронтендом, Keycloak и API. Keycloak отвечает за
IAM/SSO: PKCE S256, MFA/OTP, LDAP User Federation, RBAC и Identity Brokering
для Яндекс ID.

Фронтенд не получает Keycloak `access_token` и `refresh_token`. Браузер
отправляет в `bionicpro-auth` только session cookie с флагами `HttpOnly`,
`Secure` и `SameSite=Lax`. `refresh_token` хранится на сервере в зашифрованном
виде, `access_token` привязан к серверной сессии.

Яндекс ID подключён через локальный OIDC-адаптер в `bionicpro-auth`. Keycloak
видит его как внешний IdP, а адаптер ходит в OAuth 2.0 Яндекса и API профиля.
Профили внешних IdP сохраняются в `Auth DB`.

## Отчёты

Файл: `bionicpro-reports-c4.drawio`.

Фронтенд вызывает `/api/reports` через `bionicpro-auth` с
`credentials: include`. `bionicpro-auth` проксирует запрос в `reports-api` и
передаёт серверный Bearer-токен.

`reports-api` проверяет JWT через Keycloak JWKS, берёт пользователя из claims и
читает ClickHouse-витрину. Тяжёлые join и агрегации в момент запроса не
выполняются. Airflow DAG `bionicpro_reports_daily` считает дневные агрегаты
телеметрии, обновляет `report_telemetry_daily`, `etl_watermarks` и маркер
версии отчётов в S3. CRM-измерения поступают в ClickHouse через CDC.

В схеме показаны пользовательский запрос отчёта, серверная сессия,
`reports-api`, OLAP-витрина и Airflow watermark.

## S3/CDN

Файл: `bionicpro-reports-cache-c4.drawio`.

`reports-api` читает маркер версии в S3, манифест отчёта и проверяет объект
через `HEAD`. Если актуальный объект уже есть, API возвращает подписанный CDN
URL без запроса в ClickHouse.

Если объекта нет, API читает ClickHouse-витрину, сохраняет JSON-отчёт и
манифест в MinIO/S3. Airflow пишет watermark в ClickHouse и маркер версии в S3.
`reports-cdn` на Nginx проверяет подписанный URL через `secure_link` и кеширует
JSON-отчёты из MinIO.

## CDC для CRM

Файл: `bionicpro-reports-cdc-c4.drawio`.

CRM-данные попадают в ClickHouse без массовой batch-выгрузки:

- Debezium читает PostgreSQL WAL из CRM DB и пишет изменения таблиц `customers`
  и `prostheses` в Kafka topics;
- ClickHouse читает topics через KafkaEngine;
- MaterializedView обновляет CDC-таблицы и витрину `report_user_daily_current`;
- Airflow загружает только агрегаты по телеметрии;
- `reports-versioner` пишет маркер версии в S3 на основе текущей витрины
  ClickHouse.
