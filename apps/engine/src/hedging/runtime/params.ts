import type { Logger } from "pino";
import { z } from "zod";

import { DEFAULT_RISK_PARAMS } from "@winz/shared";

import type { AllocationSql } from "../allocation";
import type { PolicyParams } from "../policy";

/** The risk parameters of `engine_params`, typed (SPEC 9.3). Missing keys take the defaults. */
export interface RiskParams {
  uMaxMicroUsdc: bigint;
  makerTtlSeconds: number;
  askMoveTicks: number;
  toleranceTicks: number;
  forceTakerMinutes: number;
}

export const DEFAULT_RUNTIME_RISK_PARAMS: Readonly<RiskParams> = Object.freeze({
  uMaxMicroUsdc: DEFAULT_RISK_PARAMS.uMaxMicroUsdc,
  makerTtlSeconds: DEFAULT_RISK_PARAMS.makerTtlSeconds,
  askMoveTicks: DEFAULT_RISK_PARAMS.askMoveTicks,
  toleranceTicks: DEFAULT_RISK_PARAMS.toleranceTicks,
  forceTakerMinutes: DEFAULT_RISK_PARAMS.forceTakerMinutes,
});

/** A JSON number or a string of digits (how the schema stores wide integers in jsonb). */
const digits = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^[0-9]+$/, "a string of digits"),
]);

const VALUE_SCHEMAS = {
  uMaxMicroUsdc: digits.transform((value) => BigInt(value)),
  makerTtlSeconds: digits
    .transform((value) => Number(value))
    .pipe(z.number().int().min(0).max(86_400)),
  askMoveTicks: digits.transform((value) => Number(value)).pipe(z.number().int().min(1).max(100)),
  toleranceTicks: digits.transform((value) => Number(value)).pipe(z.number().int().min(0).max(100)),
  forceTakerMinutes: digits
    .transform((value) => Number(value))
    .pipe(z.number().int().min(0).max(10_080)),
} as const;

type RiskKey = keyof typeof VALUE_SCHEMAS;

function isRiskKey(key: string): key is RiskKey {
  return Object.prototype.hasOwnProperty.call(VALUE_SCHEMAS, key);
}

/**
 * Reads the risk parameters from `engine_params` (key = the field name of `DEFAULT_RISK_PARAMS`,
 * value = a JSON number or a string of digits). A missing key takes its default; an invalid value
 * is logged and takes its default too, so a typo in one row never stops hedging.
 */
export async function loadRiskParams(sql: AllocationSql, logger: Logger): Promise<RiskParams> {
  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from engine_params where key = any(${Object.keys(VALUE_SCHEMAS)}::text[])
  `;
  const params: RiskParams = { ...DEFAULT_RUNTIME_RISK_PARAMS };
  for (const row of rows) {
    if (!isRiskKey(row.key)) continue;
    const parsed = VALUE_SCHEMAS[row.key].safeParse(row.value);
    if (!parsed.success) {
      logger.warn(
        { key: row.key, issue: parsed.error.issues[0]?.message ?? "invalid" },
        "invalid engine_params value: the default is used",
      );
      continue;
    }
    switch (row.key) {
      case "uMaxMicroUsdc":
        params.uMaxMicroUsdc = parsed.data as bigint;
        break;
      case "makerTtlSeconds":
        params.makerTtlSeconds = parsed.data as number;
        break;
      case "askMoveTicks":
        params.askMoveTicks = parsed.data as number;
        break;
      case "toleranceTicks":
        params.toleranceTicks = parsed.data as number;
        break;
      case "forceTakerMinutes":
        params.forceTakerMinutes = parsed.data as number;
        break;
    }
  }
  return params;
}

/** The policy's parameters for these risk parameters (the rest keep the policy defaults). */
export function policyParamsOf(risk: Readonly<RiskParams>): Partial<PolicyParams> {
  return {
    uMaxMicroUsdc: risk.uMaxMicroUsdc,
    makerTtlMs: risk.makerTtlSeconds * 1000,
    askMoveTicks: risk.askMoveTicks,
    forceTakerMs: risk.forceTakerMinutes * 60 * 1000,
  };
}
