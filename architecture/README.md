# Архитектура безопасности BionicPRO

`bionicpro-security-c4.drawio` показывает изменения для задания 1:

- `bionicpro-auth` стоит между фронтендом, Keycloak и API.
- Keycloak отвечает за PKCE S256, MFA/OTP, LDAP federation, RBAC и Yandex ID.
- OIDC bridge внутри `bionicpro-auth` подключает Yandex ID к Keycloak Identity
  Brokering, ходит в OAuth 2.0 Яндекса и получает профиль пользователя.
- `refresh_token` шифруется в памяти, `access_token` привязан к серверной
  сессии.
- `Auth DB` хранит профили внешних IdP, полученные от Yandex ID.

Фронтенд не получает Keycloak `access_token` и `refresh_token`. Браузер
отправляет в `bionicpro-auth` только session cookie с флагами `HttpOnly`,
`Secure` и `SameSite=Lax`.
