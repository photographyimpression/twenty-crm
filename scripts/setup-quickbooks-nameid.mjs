// One-shot metadata migration for the QuickBooks card v2 (2026-09-23):
// a `quickbooksNameId` TEXT field on person. The Add to QuickBooks button
// stores the QuickBooks Online customer id here after a successful push, and
// the record right rail switches to "Open in QuickBooks" / "Create invoice"
// once it is set.
//
// Run ON the server against the local CRM (token from the Command Center
// env, never committed):
//   TWENTY_API_TOKEN=... node setup-quickbooks-nameid.mjs
//
// Idempotent: reports "exists" when the field is already there.

const url = process.env.TWENTY_URL || 'http://localhost:3000';
const token = process.env.TWENTY_API_TOKEN;

if (!token) {
  console.error('TWENTY_API_TOKEN env var required');
  process.exit(1);
}

const post = async (query, variables = {}) => {
  const res = await fetch(`${url}/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  }
  return data;
};

const run = async () => {
  const objects = await post(`
    query {
      objects(paging: { first: 200 }) {
        edges { node { id nameSingular } }
      }
    }`);
  if (objects.errors) throw new Error(JSON.stringify(objects.errors));
  const person = objects.data.objects.edges.find(
    (e) => e.node.nameSingular === 'person',
  );
  if (!person) throw new Error('person object not found');

  const created = await post(
    `
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name type }
    }`,
    {
      input: {
        field: {
          objectMetadataId: person.node.id,
          name: 'quickbooksNameId',
          label: 'QuickBooks',
          type: 'TEXT',
          description:
            'QuickBooks Online customer id — filled automatically by the Add to QuickBooks button',
          isNullable: true,
        },
      },
    },
  );
  if (created.errors) {
    const msg = JSON.stringify(created.errors);
    if (/already|exist|duplicate/i.test(msg)) {
      console.log('quickbooksNameId already exists — nothing to do');
      return;
    }
    throw new Error(msg);
  }
  console.log(`created quickbooksNameId: ${created.data.createOneField.id}`);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
