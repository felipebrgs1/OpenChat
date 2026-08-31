import { ZodError, type ZodType } from "zod";

import { validation } from "./errors";

export async function parseBody<T>(schema: ZodType<T>, input: unknown): Promise<T> {
  try {
    return await schema.parseAsync(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const first = error.issues[0];
      throw validation(first?.message ?? "Payload inválido.");
    }
    throw error;
  }
}
