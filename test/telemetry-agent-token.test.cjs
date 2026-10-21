'use strict';

// The telemetry collector (src/main/telemetry.ts) feeds the cost cap, so usage
// must come from the agent it is counted for. Each agent's exporter sends its
// own token (hive.ts sets OTEL_EXPORTER_OTLP_HEADERS); a batch without one is
// refused, and a batch only ever counts for the agent whose token sent it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { TelemetryCollector, TELEMETRY_TOKEN_HEADER } = loadTs('src/main/telemetry.ts');

function outputBatch(agentId, sessionId, output) {
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: 'agent.id', value: { stringValue: agentId } }] },
      scopeMetrics: [{
        metrics: [{
          name: 'claude_code.token.usage',
          sum: {
            dataPoints: [{
              asInt: String(output),
              attributes: [
                { key: 'session.id', value: { stringValue: sessionId } },
                { key: 'type', value: { stringValue: 'output' } }
              ]
            }]
          }
        }]
      }]
    }]
  };
}

async function post(endpoint, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token !== undefined) headers[TELEMETRY_TOKEN_HEADER] = token;
  const response = await fetch(`${endpoint}/v1/metrics`, { method: 'POST', headers, body: JSON.stringify(body) });
  await response.text();
  return response.status;
}

async function started(t) {
  const telemetry = new TelemetryCollector({ host: '127.0.0.1', port: 0 });
  await telemetry.start();
  t.after(() => telemetry.stop());
  return { telemetry, endpoint: telemetry.endpoint() };
}

test('a batch without a token, or with an unknown one, is refused and not counted', async (t) => {
  const { telemetry, endpoint } = await started(t);
  telemetry.tokenFor('agent-1');
  assert.equal(await post(endpoint, outputBatch('agent-1', 's1', 900)), 401);
  assert.equal(await post(endpoint, outputBatch('agent-1', 's1', 900), 'not-a-token'), 401);
  assert.equal(telemetry.getAgentUsage('agent-1'), null);
});

test("an agent's token cannot report usage for another agent", async (t) => {
  const { telemetry, endpoint } = await started(t);
  const pete = telemetry.tokenFor('pete');
  telemetry.tokenFor('agent-2');
  assert.equal(await post(endpoint, outputBatch('agent-2', 's2', 5000), pete), 200);
  assert.equal(telemetry.getAgentUsage('agent-2'), null);
});

test("an agent cannot add to another agent's session by reusing its id", async (t) => {
  const { telemetry, endpoint } = await started(t);
  const one = telemetry.tokenFor('agent-1');
  const two = telemetry.tokenFor('agent-2');
  await post(endpoint, outputBatch('agent-1', 'shared', 100), one);
  await post(endpoint, outputBatch('agent-2', 'shared', 5000), two);
  assert.equal(telemetry.getAgentUsage('agent-1').output, 100);
  assert.equal(telemetry.getAgentUsage('agent-2'), null);
});

test('a negative value cannot lower what an agent has spent', async (t) => {
  const { telemetry, endpoint } = await started(t);
  const token = telemetry.tokenFor('agent-1');
  await post(endpoint, outputBatch('agent-1', 's1', 900), token);
  await post(endpoint, outputBatch('agent-1', 's1', -800), token);
  assert.equal(telemetry.getAgentUsage('agent-1').output, 900);
});

test('each agent keeps one token for the life of the collector', () => {
  const telemetry = new TelemetryCollector();
  assert.equal(telemetry.tokenFor('agent-1'), telemetry.tokenFor('agent-1'));
  assert.notEqual(telemetry.tokenFor('agent-1'), telemetry.tokenFor('agent-2'));
});

test("spawned agents' exporters send their token", () => {
  const hive = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'hive.ts'), 'utf8');
  assert.match(hive, /env\.OTEL_EXPORTER_OTLP_HEADERS = `\$\{TELEMETRY_TOKEN_HEADER\}=\$\{this\._otelToken\(meta\.id\)\}`/);
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  assert.match(index, /hive\.setOtelEndpoint\(r\.endpoint, \(agentId\) => telemetry\.tokenFor\(agentId\)\)/);
});
