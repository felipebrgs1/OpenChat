import { like, or } from "drizzle-orm";
import { db, users } from "@nexo/db";

/**
 * Emails usados exclusivamente pelos testes e2e.
 * afterAll de cada suíte chama deleteTestUsers() para não deixar
 * resíduo (usuários, conversas, mensagens, usage) no banco de dev.
 * Conversas em cascade: conversation.user_id → ON DELETE CASCADE.
 */
const TEST_USER_EMAIL_PATTERNS = [
  "dev+%@empresa.com",
  "chatb+%@empresa.com",
  "gov-%@empresa.com",
  "kb-%@empresa.com",
  "semcargo+%@empresa.com",
];

export async function deleteTestUsers() {
  const deleted = await db
    .delete(users)
    .where(or(...TEST_USER_EMAIL_PATTERNS.map((pattern) => like(users.email, pattern))))
    .returning({ email: users.email });
  if (process.env.DEBUG_CLEANUP === "1") {
    console.log(
      `[cleanup] deleteTestUsers: ${deleted.length} usuários`,
      deleted.map((u) => u.email),
    );
  }
}
