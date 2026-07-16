# Guia de Integração API MedFlow

Este guia fornece informações detalhadas para a integração com a API da MedFlow, focada no gerenciamento de solicitações de empréstimo e perfis médicos.

## 1. Autenticação

A API utiliza **JWT (JSON Web Tokens)** para proteger as rotas sob o prefixo `/protected/`.

### Fluxo de Autenticação

1. **Login:** Realize uma requisição `POST` para `/sign_in` com seu email e senha.
2. **Token:** A resposta conterá um campo `access_token`.
3. **Uso:** Envie este token em todas as requisições para rotas protegidas no header:
   `Authorization: Bearer <seu_access_token>`

> **Nota:** O logout (`DELETE /sign_out`) invalida o token atual rotacionando o identificador interno (jti).

## 2. Ambientes

- **Produção:** `https://medflow-hhrc.onrender.com/api/v1`
- **Local (Desenvolvimento):** `http://127.0.0.1:3000/api/v1`

## 3. Boas Práticas

### Gerenciamento de Cadastro

- **DoctorID:** A API integra-se com o DoctorID. Se o CPF/CRM já existir como registro pendente, a criação do usuário apenas ativará o registro.
- **Divergências:** Caso os dados de CPF/CRM não coincidam com registros existentes, a API retornará erro 422.

### Operações de Empréstimo

- **Recebíveis:** Antes de criar um empréstimo, liste os recebíveis elegíveis via `GET /protected/receivables`.
- **Assinatura de Contrato:** A API utiliza a Clicksign. Após a criação do empréstimo, você pode forçar a verificação da assinatura usando `POST /protected/loans/{id}/refresh_signature`.

### Notificações

- **Push Expo:** Para apps nativos, utilize `PATCH /protected/profile/update_push_notification_token`.
- **Web Push:** Para aplicações web, utilize o padrão VAPID via `POST /protected/web_push_subscriptions`.

## 4. Tratamento de Erros

- **200 / 201:** Sucesso.
- **401 Unauthorized:** Token ausente, inválido ou expirado.
- **404 Not Found:** Recurso não encontrado.
- **422 Unprocessable Entity:** Erro de validação nos parâmetros enviados.

---

*Documentação técnica MedFlow - 2026*
