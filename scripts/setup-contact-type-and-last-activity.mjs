// One-shot migration for two board cards (Aug 18, 2026):
//
//   1. "Contact Type needs to be a dropdown (Lead / Customer / Other)"
//      ghlContactType is a TEXT field (GHL import) and Twenty cannot change
//      a field's type in place, so: create a fresh SELECT `contactType`
//      field, the caller migrates the data + view column via SQL
//      (migrate-contact-type.sql), then --delete-old archives ghlContactType.
//
//   2. "A Last Activity field so I can see who I last touched"
//      Creates a `lastActivityAt` DATE_TIME field. The SQL side backfills it
//      from timeline activities/notes and installs triggers that keep it
//      fresh (see migrate-contact-type.sql).
//
// Run ON the server against the local CRM (token from the Command Center
// env, never committed):
//   node setup-contact-type-and-last-activity.mjs --create
//   psql ... -f migrate-contact-type.sql   # data migration + triggers
//   node setup-contact-type-and-last-activity.mjs --delete-old
//
// Idempotent: --create skips fields that already exist; --delete-old skips
// when ghlContactType is gone.

const url = process.env.TWENTY_URL || 'http://localhost:3000';
const token = process.env.TWENTY_API_TOKEN;

if (!token) {
  console.error('TWENTY_API_TOKEN env var required');
  process.exit(1);
}

const mode = process.argv[2] ?? '--create';

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
  if (data.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
};

const personObject = async () => {
  const data = await post(`
    query {
      objects(paging: { first: 200 }) {
        edges {
          node {
            id
            nameSingular
            fields(paging: { first: 200 }) {
              edges { node { id name type } }
            }
          }
        }
      }
    }
  `);
  const obj = data.objects.edges.find((e) => e.node.nameSingular === 'person');
  if (!obj) throw new Error('person object not found');
  return obj.node;
};

const createField = async (objectMetadataId, field) => {
  const data = await post(
    `
    mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
      createOneField(input: $input) { id name type }
    }
  `,
    { input: { field: { objectMetadataId, isNullable: true, ...field } } },
  );
  return data.createOneField;
};

const deleteField = async (id) => {
  const data = await post(
    `
    mutation DeleteOneField($input: DeleteOneFieldInput!) {
      deleteOneField(input: $input)
    }
  `,
    { input: { id } },
  );
  return data.deleteOneField;
};

const run = async () => {
  const person = await personObject();
  const existing = new Map(person.fields.edges.map((e) => [e.node.name, e.node]));

  if (mode === '--create') {
    if (!existing.has('contactType')) {
      const created = await createField(person.id, {
        name: 'contactType',
        label: 'Contact Type',
        type: 'SELECT',
        description: 'Lead, customer or other — replaced the imported text field',
        options: [
          { color: 'blue', label: 'Lead', value: 'LEAD', position: 0 },
          { color: 'green', label: 'Customer', value: 'CUSTOMER', position: 1 },
          { color: 'gray', label: 'Other', value: 'OTHER', position: 2 },
        ].map((o) => ({ ...o, id: crypto.randomUUID() })),
      });
      console.log(`created contactType: ${created.id}`);
    } else {
      console.log(`contactType already exists: ${existing.get('contactType').id}`);
    }

    if (!existing.has('lastActivityAt')) {
      const created = await createField(person.id, {
        name: 'lastActivityAt',
        label: 'Last Activity',
        type: 'DATE_TIME',
        description:
          'When this person was last touched: call, text, email, note or edit (auto)',
      });
      console.log(`created lastActivityAt: ${created.id}`);
    } else {
      console.log(`lastActivityAt already exists: ${existing.get('lastActivityAt').id}`);
    }
    console.log(
      `next: run migrate-contact-type.sql, then --delete-old (ghlContactType id: ${existing.get('ghlContactType')?.id ?? 'gone'})`,
    );
    return;
  }

  if (mode === '--delete-old') {
    const old = existing.get('ghlContactType');
    if (!old) {
      console.log('ghlContactType already gone');
      return;
    }
    await deleteField(old.id);
    console.log(`archived ghlContactType (${old.id})`);
    return;
  }

  console.error(`unknown mode ${mode} (use --create or --delete-old)`);
  process.exit(1);
};

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
