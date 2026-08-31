import { eq } from "drizzle-orm";

import { db as defaultDb } from "./index";
import { organizationSettings, roleStarterPrompts, roles, users } from "./schema";
import { GLOBAL_SYSTEM_PROMPT, ROLE_SEEDS } from "./seed-data";

export async function seed(db = defaultDb) {
  const roleIds = new Map<string, string>();

  for (const role of ROLE_SEEDS) {
    const existing = (await db.select().from(roles).where(eq(roles.slug, role.slug)))[0];
    const values = {
      slug: role.slug,
      name: role.name,
      description: role.description,
      systemPrompt: role.systemPrompt,
      welcomeMd: role.welcomeMd,
      isSystem: true,
      updatedAt: new Date(),
    };

    const row = existing
      ? (await db.update(roles).set(values).where(eq(roles.id, existing.id)).returning())[0]
      : (await db.insert(roles).values(values).returning())[0];

    if (!row) {
      throw new Error(`Falha ao gravar cargo ${role.slug}`);
    }

    roleIds.set(role.slug, row.id);
    await db.delete(roleStarterPrompts).where(eq(roleStarterPrompts.roleId, row.id));
    await db.insert(roleStarterPrompts).values(
      role.starters.map((starter, index) => ({
        roleId: row.id,
        title: starter.title,
        prompt: starter.prompt,
        sortOrder: index,
      })),
    );
  }

  const settings = (await db.select().from(organizationSettings).limit(1))[0];
  const settingsValues = {
    name: "Nexo",
    globalSystemPrompt: GLOBAL_SYSTEM_PROMPT,
    defaultModel: "z-ai/glm-5.3-flash",
    fallbackModel: "z-ai/glm-5.3-flash",
    allowedModels: ["z-ai/glm-5.3-flash"],
    updatedAt: new Date(),
  };

  if (settings) {
    await db
      .update(organizationSettings)
      .set(settingsValues)
      .where(eq(organizationSettings.id, settings.id));
  } else {
    await db.insert(organizationSettings).values(settingsValues);
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const adminRoleId = roleIds.get("admin");

  if (adminEmail && adminPassword && adminRoleId) {
    const passwordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id" });
    const existingAdmin = (await db.select().from(users).where(eq(users.email, adminEmail)))[0];
    if (existingAdmin) {
      await db
        .update(users)
        .set({
          isAdmin: true,
          roleId: adminRoleId,
          status: "active",
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingAdmin.id));
    } else {
      await db.insert(users).values({
        name: "Admin",
        email: adminEmail,
        passwordHash,
        isAdmin: true,
        roleId: adminRoleId,
        status: "active",
        emailVerified: true,
        onboardedAt: new Date(),
      });
    }
  }

  return { roleIds };
}

if (import.meta.main) {
  await seed();
  console.log("seed ok");
}
