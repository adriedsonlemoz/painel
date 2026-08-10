import 'dotenv/config'
import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV: z.enum(['development','production','test']).default('development'),
  PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(24).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  REDIS_URL: z.string().optional(),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) console.warn('Configuração de ambiente parcial; o painel interno poderá concluir a configuração.')
export const env = parsed.success ? parsed.data : { NODE_ENV: process.env.NODE_ENV || 'development', PORT: Number(process.env.PORT || 3001) }
