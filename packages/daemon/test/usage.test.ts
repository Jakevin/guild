import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addUsage,
  blankUsage,
  fromAnthropicUsage,
  fromOpenAiUsage,
  fromPiUsage,
} from "../src/usage.ts";

test("addUsage sums pi-ai rounds", () => {
  const acc = blankUsage();
  addUsage(acc, fromPiUsage({
    input: 100,
    output: 40,
    totalTokens: 140,
    cost: { total: 0.01 },
  }));
  addUsage(acc, fromPiUsage({
    input: 20,
    output: 10,
    totalTokens: 30,
    cost: { total: 0.002 },
  }));
  assert.equal(acc.input, 120);
  assert.equal(acc.output, 50);
  assert.equal(acc.totalTokens, 170);
  assert.equal(acc.rounds, 2);
  assert.ok(Math.abs((acc.costUsd ?? 0) - 0.012) < 1e-9);
});

test("fromOpenAiUsage and fromAnthropicUsage map provider fields", () => {
  const oa = fromOpenAiUsage({
    prompt_tokens: 80,
    completion_tokens: 20,
    total_tokens: 100,
  });
  assert.equal(oa.input, 80);
  assert.equal(oa.output, 20);
  assert.equal(oa.totalTokens, 100);
  const ant = fromAnthropicUsage({ input_tokens: 50, output_tokens: 7 });
  assert.equal(ant.input, 50);
  assert.equal(ant.totalTokens, 57);
});
