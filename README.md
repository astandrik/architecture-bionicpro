# BionicPRO

- `bionicpro-auth`: backend для OAuth/OIDC. Он запускает Authorization Code
  Flow with PKCE S256, хранит `access_token` и `refresh_token` на сервере,
  ротирует session id и отдаёт браузеру только сессионную cookie.
- `keycloak`: realm с PKCE, коротким `access_token`, MFA/OTP, LDAP User
  Federation, RBAC и Identity Brokering для Яндекс ID.
- `reports-api`: API `/reports`. Проверяет JWT через JWKS, отдаёт пользователю
  только его отчёт и читает данные из ClickHouse.
- `airflow`: DAG `bionicpro_reports_daily`. Загружает агрегаты телеметрии в
  ClickHouse и обновляет watermark обработанного периода.
- `clickhouse`: OLAP-таблицы, KafkaEngine и MaterializedView для CDC-данных из
  CRM.
- `debezium` и `docker-compose.yaml`: поток изменений из CRM PostgreSQL в Kafka
  через Debezium PostgreSQL Connector.
- `nginx`: reverse proxy для JSON-отчётов из MinIO/S3 с подписанными CDN URL.
- `frontend`: страница отчёта. Работает через `bionicpro-auth` и cookie-based
  session.
- `architecture`: C4-диаграммы по безопасности, отчётам, S3/CDN и CDC.

## Запуск

Поднять все сервисы:

```bash
docker compose up --build
```

Для реального Яндекс ID передайте OAuth client id и secret:

```bash
YANDEX_CLIENT_ID=<client-id> YANDEX_CLIENT_SECRET=<client-secret> docker compose up --build
```

Локальные адреса:

- frontend: `http://localhost:3001`
- `bionicpro-auth`: `http://localhost:8000`
- `reports-api`: `http://localhost:8001`
- Keycloak: `http://localhost:8080`
- Airflow: `http://localhost:8081`
- Reports CDN: `http://localhost:8082/reports`
- Kafka Connect: `http://localhost:8083`
- MinIO Console: `http://localhost:9003`
- ClickHouse HTTP: `http://localhost:8123`

Локальные учётки:

- Keycloak: `admin` / `admin`
- Airflow: `admin` / `admin`
- MinIO: `minioadmin` / `minioadmin123`

## Быстрые проверки

```bash
cd frontend && npm run build
docker compose config --quiet
git diff --check
```

## Архитектура

- `architecture/bionicpro-security-c4.drawio`
- `architecture/bionicpro-reports-c4.drawio`
- `architecture/bionicpro-reports-cache-c4.drawio`
- `architecture/bionicpro-reports-cdc-c4.drawio`

PNG-версии лежат рядом с исходниками draw.io.
