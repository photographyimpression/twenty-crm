import { FieldActorSource } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { type EntityManager } from 'typeorm';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { findFlatEntityByIdInFlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-id-in-flat-entity-maps.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { buildObjectIdByNameMaps } from 'src/engine/metadata-modules/flat-object-metadata/utils/build-object-id-by-name-maps.util';
import { generateObjectRecordFields } from 'src/modules/workflow/workflow-builder/workflow-schema/utils/generate-object-record-fields';

const QUICK_LEAD_WORKFLOW_ID = '8b213cac-a68b-4ffe-817a-3ec994e9932d';
const QUICK_LEAD_WORKFLOW_VERSION_ID = 'ac67974f-c524-4288-9d88-af8515400b68';

// 12-Touch Lead Sequence Workflow IDs
const LEAD_SEQUENCE_WORKFLOW_ID = 'f1a2b3c4-d5e6-4f78-9012-abcdef123456';
const LEAD_SEQUENCE_VERSION_ID = 'a2b3c4d5-e6f7-4890-1234-bcdef1234567';

// Execute Approved Touch Workflow IDs
const EXECUTE_TOUCH_WORKFLOW_ID = 'b3c4d5e6-f7a8-4901-2345-cdef12345678';
const EXECUTE_TOUCH_VERSION_ID = 'c4d5e6f7-a8b9-4012-3456-def123456789';

// Step IDs for Lead Sequence Workflow (Workflow A)
const LS_STEP = {
  createCompany: '10000001-0001-4000-8000-000000000001',
  createPerson: '10000001-0002-4000-8000-000000000002',
  createOpportunity: '10000001-0003-4000-8000-000000000003',
  createTaskFollowUp: '10000001-0004-4000-8000-000000000004',
  ifElseHighValue: '10000001-0005-4000-8000-000000000005',
  createTaskLoom: '10000001-0006-4000-8000-000000000006',
  approvalTouch1: '10000001-0007-4000-8000-000000000007',
  approvalTouch2: '10000001-0008-4000-8000-000000000008',
  approvalTouch3: '10000001-0009-4000-8000-000000000009',
  approvalTouch4: '10000001-000a-4000-8000-00000000000a',
  approvalTouch5: '10000001-000b-4000-8000-00000000000b',
  approvalTouch6: '10000001-000c-4000-8000-00000000000c',
  approvalTouch7: '10000001-000d-4000-8000-00000000000d',
  approvalTouch8: '10000001-000e-4000-8000-00000000000e',
  approvalTouch9: '10000001-000f-4000-8000-000000000010',
  approvalTouch10: '10000001-0010-4000-8000-000000000011',
  approvalTouch11: '10000001-0011-4000-8000-000000000012',
  approvalTouch12: '10000001-0012-4000-8000-000000000013',
};

// Step IDs for Execute Approved Touch Workflow (Workflow B)
const ET_STEP = {
  findApproval: '20000001-0001-4000-8000-000000000001',
  ifApproved: '20000001-0002-4000-8000-000000000002',
  ifActionType: '20000001-0003-4000-8000-000000000003',
  sendEmail: '20000001-0004-4000-8000-000000000004',
  httpLinkedIn: '20000001-0005-4000-8000-000000000005',
  httpSms: '20000001-0006-4000-8000-000000000006',
  createPhoneTask: '20000001-0007-4000-8000-000000000007',
  updateCompleted: '20000001-0008-4000-8000-000000000008',
};

// Filter/branch IDs
const FILTER_IDS = {
  hvFilterGroup: '30000001-0001-4000-8000-000000000001',
  hvFilterJewelry: '30000001-0002-4000-8000-000000000002',
  hvFilterAmazon: '30000001-0003-4000-8000-000000000003',
  hvBranchTrue: '30000001-0004-4000-8000-000000000004',
  hvBranchFalse: '30000001-0005-4000-8000-000000000005',
  approvedFilterGroup: '30000001-0006-4000-8000-000000000006',
  approvedFilter: '30000001-0007-4000-8000-000000000007',
  approvedBranchYes: '30000001-0008-4000-8000-000000000008',
  approvedBranchNo: '30000001-0009-4000-8000-000000000009',
  emailFilterGroup: '30000001-000a-4000-8000-00000000000a',
  emailFilter: '30000001-000b-4000-8000-00000000000b',
  emailBranch: '30000001-000c-4000-8000-00000000000c',
  linkedinFilterGroup: '30000001-000d-4000-8000-00000000000d',
  linkedinFilter: '30000001-000e-4000-8000-00000000000e',
  linkedinBranch: '30000001-000f-4000-8000-000000000010',
  smsFilterGroup: '30000001-0010-4000-8000-000000000011',
  smsFilter: '30000001-0011-4000-8000-000000000012',
  smsBranch: '30000001-0012-4000-8000-000000000013',
  phoneBranch: '30000001-0013-4000-8000-000000000014',
};

// Helper: generate an approval CREATE_RECORD step
function makeApprovalStep(
  id: string,
  nextStepId: string | null,
  touchNumber: number,
  actionType: string,
  emailSubject: string,
  emailBody: string,
  dayOffset: number,
) {
  return {
    id,
    name: `Create Approval: Touch ${touchNumber}`,
    type: 'CREATE_RECORD',
    valid: true,
    settings: {
      input: {
        objectName: 'approval',
        objectRecord: {
          name: `Touch ${touchNumber}: ${emailSubject}`,
          actionType: actionType,
          approvalStatus: 'PENDING',
          touchNumber: touchNumber,
          emailSubject: emailSubject,
          emailBody: emailBody,
          recipientEmail: `{{${LS_STEP.createPerson}.emails.primaryEmail}}`,
          leadName: `{{trigger.firstName}} {{trigger.lastName}}`,
          companyName: `{{trigger.company}}`,
          productType: `{{trigger.productType}}`,
          // scheduledDate would be computed via CODE step in production
          // For now, use a placeholder
        },
      },
      outputSchema: {},
      errorHandlingOptions: {
        retryOnFailure: { value: false },
        continueOnFailure: { value: true },
      },
    },
    __typename: 'WorkflowAction',
    nextStepIds: nextStepId ? [nextStepId] : null,
  };
}

export const prefillWorkflows = async (
  entityManager: EntityManager,
  schemaName: string,
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>,
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>,
) => {
  const { idByNameSingular: objectIdByNameSingular } = buildObjectIdByNameMaps(
    flatObjectMetadataMaps,
  );

  const companyObjectMetadataId = objectIdByNameSingular['company'];
  const personObjectMetadataId = objectIdByNameSingular['person'];

  if (
    !isDefined(companyObjectMetadataId) ||
    !isDefined(personObjectMetadataId)
  ) {
    throw new Error('Company or person object metadata not found');
  }

  const companyObjectMetadata = findFlatEntityByIdInFlatEntityMaps({
    flatEntityId: companyObjectMetadataId,
    flatEntityMaps: flatObjectMetadataMaps,
  });

  const personObjectMetadata = findFlatEntityByIdInFlatEntityMaps({
    flatEntityId: personObjectMetadataId,
    flatEntityMaps: flatObjectMetadataMaps,
  });

  if (!isDefined(companyObjectMetadata) || !isDefined(personObjectMetadata)) {
    throw new Error('Company or person object metadata not found');
  }

  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflow`, [
      'id',
      'name',
      'lastPublishedVersionId',
      'statuses',
      'position',
      'createdBySource',
      'createdByWorkspaceMemberId',
      'createdByName',
      'createdByContext',
      'updatedBySource',
      'updatedByWorkspaceMemberId',
      'updatedByName',
    ])
    .orIgnore()
    .values([
      {
        id: QUICK_LEAD_WORKFLOW_ID,
        name: 'Quick Lead',
        lastPublishedVersionId: QUICK_LEAD_WORKFLOW_VERSION_ID,
        statuses: ['ACTIVE'],
        position: 1,
        createdBySource: FieldActorSource.SYSTEM,
        createdByWorkspaceMemberId: null,
        createdByName: 'System',
        createdByContext: {},
        updatedBySource: FieldActorSource.SYSTEM,
        updatedByWorkspaceMemberId: null,
        updatedByName: 'System',
      },
    ])
    .returning('*')
    .execute();

  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflowVersion`, [
      'id',
      'name',
      'trigger',
      'steps',
      'status',
      'position',
      'workflowId',
    ])
    .orIgnore()
    .values([
      {
        id: QUICK_LEAD_WORKFLOW_VERSION_ID,
        name: 'v1',
        trigger: JSON.stringify({
          name: 'Launch manually',
          type: 'MANUAL',
          settings: {
            outputSchema: {},
            icon: 'IconUserPlus',
            availability: { type: 'GLOBAL', locations: undefined },
          },
          nextStepIds: ['6e089bc9-aabd-435f-865f-f31c01c8f4a7'],
        }),
        steps: JSON.stringify([
          {
            id: '6e089bc9-aabd-435f-865f-f31c01c8f4a7',
            name: 'Quick Lead Form',
            type: 'FORM',
            valid: false,
            settings: {
              input: [
                {
                  id: '14d669f0-5249-4fa4-b0bb-f8bd408328d5',
                  name: 'firstName',
                  type: 'TEXT',
                  label: 'First name',
                  placeholder: 'Tim',
                },
                {
                  id: '4eb6ce85-d231-4aef-9837-744490c026d0',
                  name: 'lastName',
                  type: 'TEXT',
                  label: 'Last Name',
                  placeholder: 'Apple',
                },
                {
                  id: 'adbf0e9f-1427-49be-b4fb-092b34d97350',
                  name: 'email',
                  type: 'TEXT',
                  label: 'Email',
                  placeholder: 'timapple@apple.com',
                },
                {
                  id: '4ffc7992-9e65-4a4d-9baf-b52e62f2c273',
                  name: 'jobTitle',
                  type: 'TEXT',
                  label: 'Job title',
                  placeholder: 'CEO',
                },
                {
                  id: '42f11926-04ea-4924-94a4-2293cc748362',
                  name: 'companyName',
                  type: 'TEXT',
                  label: 'Company name',
                  placeholder: 'Apple',
                },
                {
                  id: 'd6ca80ee-26cd-466d-91bf-984d7205451c',
                  name: 'companyDomain',
                  type: 'TEXT',
                  label: 'Company domain',
                  placeholder: 'https://www.apple.com',
                },
              ],
              outputSchema: {
                email: {
                  type: 'TEXT',
                  label: 'Email',
                  value: 'My text',
                  isLeaf: true,
                },
                jobTitle: {
                  type: 'TEXT',
                  label: 'Job title',
                  value: 'My text',
                  isLeaf: true,
                },
                lastName: {
                  type: 'TEXT',
                  label: 'Last Name',
                  value: 'My text',
                  isLeaf: true,
                },
                firstName: {
                  type: 'TEXT',
                  label: 'First name',
                  value: 'My text',
                  isLeaf: true,
                },
                companyName: {
                  type: 'TEXT',
                  label: 'Company name',
                  value: 'My text',
                  isLeaf: true,
                },
                companyDomain: {
                  type: 'TEXT',
                  label: 'Company domain',
                  value: 'My text',
                  isLeaf: true,
                },
              },
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: ['0715b6cd-7cc1-4b98-971b-00f54dfe643b'],
          },
          {
            id: '0715b6cd-7cc1-4b98-971b-00f54dfe643b',
            name: 'Create Company',
            type: 'CREATE_RECORD',
            valid: false,
            settings: {
              input: {
                objectName: 'company',
                objectRecord: {
                  name: '{{6e089bc9-aabd-435f-865f-f31c01c8f4a7.companyName}}',
                  domainName: {
                    primaryLinkUrl:
                      '{{6e089bc9-aabd-435f-865f-f31c01c8f4a7.companyDomain}}',
                    primaryLinkLabel: '',
                  },
                },
              },
              outputSchema: {
                object: {
                  icon: 'IconBuildingSkyscraper',
                  label: 'Company',
                  value: 'A company',
                  isLeaf: true,
                  fieldIdName: 'id',
                  nameSingular: 'company',
                },
                _outputSchemaType: 'RECORD',
                fields: generateObjectRecordFields({
                  objectMetadataInfo: {
                    flatObjectMetadata: companyObjectMetadata,
                    flatObjectMetadataMaps,
                    flatFieldMetadataMaps,
                  },
                }),
              },
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: ['6f553ea7-b00e-4371-9d88-d8298568a246'],
          },
          {
            id: '6f553ea7-b00e-4371-9d88-d8298568a246',
            name: 'Create Person',
            type: 'CREATE_RECORD',
            valid: false,
            settings: {
              input: {
                objectName: 'person',
                objectRecord: {
                  name: {
                    lastName:
                      '{{6e089bc9-aabd-435f-865f-f31c01c8f4a7.lastName}}',
                    firstName:
                      '{{6e089bc9-aabd-435f-865f-f31c01c8f4a7.firstName}}',
                  },
                  emails: {
                    primaryEmail:
                      '{{6e089bc9-aabd-435f-865f-f31c01c8f4a7.email}}',
                    additionalEmails: [],
                  },
                  companyId: '{{0715b6cd-7cc1-4b98-971b-00f54dfe643b.id}}',
                },
              },
              outputSchema: {
                fields: generateObjectRecordFields({
                  objectMetadataInfo: {
                    flatObjectMetadata: personObjectMetadata,
                    flatObjectMetadataMaps,
                    flatFieldMetadataMaps,
                  },
                }),
              },
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: null,
          },
        ]),
        status: 'ACTIVE',
        position: 1,
        workflowId: QUICK_LEAD_WORKFLOW_ID,
      },
    ])
    .returning('*')
    .execute();

  // ========================================
  // WORKFLOW A: 12-Touch Lead Intake Sequence
  // ========================================
  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflow`, [
      'id',
      'name',
      'lastPublishedVersionId',
      'statuses',
      'position',
      'createdBySource',
      'createdByWorkspaceMemberId',
      'createdByName',
      'createdByContext',
      'updatedBySource',
      'updatedByWorkspaceMemberId',
      'updatedByName',
    ])
    .orIgnore()
    .values([
      {
        id: LEAD_SEQUENCE_WORKFLOW_ID,
        name: '12-Touch Lead Sequence',
        lastPublishedVersionId: LEAD_SEQUENCE_VERSION_ID,
        statuses: ['DRAFT'],
        position: 2,
        createdBySource: FieldActorSource.SYSTEM,
        createdByWorkspaceMemberId: null,
        createdByName: 'System',
        createdByContext: {},
        updatedBySource: FieldActorSource.SYSTEM,
        updatedByWorkspaceMemberId: null,
        updatedByName: 'System',
      },
    ])
    .returning('*')
    .execute();

  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflowVersion`, [
      'id',
      'name',
      'trigger',
      'steps',
      'status',
      'position',
      'workflowId',
    ])
    .orIgnore()
    .values([
      {
        id: LEAD_SEQUENCE_VERSION_ID,
        name: 'v1',
        trigger: JSON.stringify({
          name: 'Website Pricing Form',
          type: 'WEBHOOK',
          settings: {
            outputSchema: {
              firstName: {
                type: 'TEXT',
                label: 'First Name',
                value: 'John',
                isLeaf: true,
              },
              lastName: {
                type: 'TEXT',
                label: 'Last Name',
                value: 'Doe',
                isLeaf: true,
              },
              email: {
                type: 'TEXT',
                label: 'Email',
                value: 'john@example.com',
                isLeaf: true,
              },
              company: {
                type: 'TEXT',
                label: 'Company',
                value: 'Acme',
                isLeaf: true,
              },
              productType: {
                type: 'TEXT',
                label: 'Product Type',
                value: 'Jewelry',
                isLeaf: true,
              },
            },
            httpMethod: 'POST',
          },
          nextStepIds: [LS_STEP.createCompany],
        }),
        steps: JSON.stringify([
          // Step 1: Create Company
          {
            id: LS_STEP.createCompany,
            name: 'Create Company',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'company',
                objectRecord: {
                  name: '{{trigger.company}}',
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [LS_STEP.createPerson],
          },
          // Step 2: Create Person
          {
            id: LS_STEP.createPerson,
            name: 'Create Person',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'person',
                objectRecord: {
                  name: {
                    firstName: '{{trigger.firstName}}',
                    lastName: '{{trigger.lastName}}',
                  },
                  emails: {
                    primaryEmail: '{{trigger.email}}',
                    additionalEmails: [],
                  },
                  companyId: `{{${LS_STEP.createCompany}.id}}`,
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [LS_STEP.createOpportunity],
          },
          // Step 3: Create Opportunity
          {
            id: LS_STEP.createOpportunity,
            name: 'Create Opportunity',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'opportunity',
                objectRecord: {
                  name: `{{trigger.productType}} photography - {{trigger.company}}`,
                  stage: 'INCOMING',
                  companyId: `{{${LS_STEP.createCompany}.id}}`,
                  pointOfContactId: `{{${LS_STEP.createPerson}.id}}`,
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [LS_STEP.createTaskFollowUp],
          },
          // Step 4: Create follow-up task (1hr)
          {
            id: LS_STEP.createTaskFollowUp,
            name: 'Create Follow-Up Task',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'task',
                objectRecord: {
                  title:
                    'Follow up: {{trigger.firstName}} {{trigger.lastName}} @ {{trigger.company}} ({{trigger.productType}})',
                  status: 'TODO',
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [LS_STEP.ifElseHighValue],
          },
          // Step 5: IF_ELSE - High Value lead?
          {
            id: LS_STEP.ifElseHighValue,
            name: 'High-Value Product?',
            type: 'IF_ELSE',
            valid: true,
            settings: {
              input: {
                stepFilterGroups: [
                  { id: FILTER_IDS.hvFilterGroup, logicalOperator: 'OR' },
                ],
                stepFilters: [
                  {
                    id: FILTER_IDS.hvFilterJewelry,
                    type: 'TEXT',
                    stepOutputKey: '{{trigger.productType}}',
                    operand: 'CONTAINS',
                    value: 'Jewelry',
                    stepFilterGroupId: FILTER_IDS.hvFilterGroup,
                  },
                  {
                    id: FILTER_IDS.hvFilterAmazon,
                    type: 'TEXT',
                    stepOutputKey: '{{trigger.productType}}',
                    operand: 'CONTAINS',
                    value: 'Amazon',
                    stepFilterGroupId: FILTER_IDS.hvFilterGroup,
                  },
                ],
                branches: [
                  {
                    id: FILTER_IDS.hvBranchTrue,
                    filterGroupId: FILTER_IDS.hvFilterGroup,
                    nextStepIds: [LS_STEP.createTaskLoom],
                  },
                  {
                    id: FILTER_IDS.hvBranchFalse,
                    nextStepIds: [LS_STEP.approvalTouch1],
                  },
                ],
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: null,
          },
          // Step 6: Create Loom Task (High Value only)
          {
            id: LS_STEP.createTaskLoom,
            name: 'Create Loom Video Task',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'task',
                objectRecord: {
                  title:
                    'Record 30s Loom video for {{trigger.firstName}} @ {{trigger.company}} ({{trigger.productType}})',
                  status: 'TODO',
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [LS_STEP.approvalTouch1],
          },
          // Steps 7-18: Create all 12 approval records
          makeApprovalStep(
            LS_STEP.approvalTouch1,
            LS_STEP.approvalTouch2,
            1,
            'SEND_EMAIL',
            'Your Pricing Request - Impression Photography',
            'Hello {{trigger.firstName}},\n\nThanks for your pricing request!\n\nAt what number can I reach you to get more info about your project?\n\nMoshe Lerner\nImpression Photography | Montreal',
            0,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch2,
            LS_STEP.approvalTouch3,
            2,
            'LINKEDIN_CONNECT',
            'LinkedIn Connection',
            'Hi {{trigger.firstName}}, saw you requested pricing for {{trigger.productType}} photography. Looking forward to working together!',
            0,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch3,
            LS_STEP.approvalTouch4,
            3,
            'SMS_NOTIFY',
            'New Lead Alert',
            'New lead: {{trigger.firstName}} {{trigger.lastName}} @ {{trigger.company}} ({{trigger.productType}}). Call now!',
            0,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch4,
            LS_STEP.approvalTouch5,
            4,
            'SEND_EMAIL',
            'Personal video for {{trigger.company}}',
            'Hi {{trigger.firstName}}, I recorded a quick 30-second video showing how we handle {{trigger.productType}} photography. Check it out: [LOOM_LINK]',
            0,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch5,
            LS_STEP.approvalTouch6,
            5,
            'SEND_EMAIL',
            'Quick question about your {{trigger.productType}} photography',
            'Hi {{trigger.firstName}},\n\nI wanted to share a before/after from a recent {{trigger.productType}} shoot. The difference in conversion rates is dramatic.\n\n[CASE_STUDY_LINK]\n\nWould you like to hop on a quick 5-min call? [CALENDLY_LINK]\n\nMoshe',
            1,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch6,
            LS_STEP.approvalTouch7,
            6,
            'SEND_EMAIL',
            'Free test shot for {{trigger.company}}',
            'Hi {{trigger.firstName}},\n\nI am doing a shoot for a similar {{trigger.productType}} brand next week. Send a single test item and I will shoot it free so you can see the quality before committing.\n\nLocal Montreal pickup available.\n\nMoshe',
            3,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch7,
            LS_STEP.approvalTouch8,
            7,
            'PHONE_TASK',
            'Call {{trigger.firstName}} @ {{trigger.company}}',
            'Manual phone call attempt #1. Reference their {{trigger.productType}} inquiry.',
            3,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch8,
            LS_STEP.approvalTouch9,
            8,
            'LINKEDIN_DM',
            'Portfolio piece for {{trigger.company}}',
            'Hi {{trigger.firstName}}, thought you might like this recent {{trigger.productType}} shoot we did. [PORTFOLIO_LINK]',
            5,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch9,
            LS_STEP.approvalTouch10,
            9,
            'SEND_EMAIL',
            'What our clients say about {{trigger.productType}} shoots',
            'Hi {{trigger.firstName}},\n\nHere is what a recent {{trigger.productType}} client said about working with us:\n\n[TESTIMONIAL]\n\nWould love to deliver the same results for {{trigger.company}}.\n\nMoshe',
            7,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch10,
            LS_STEP.approvalTouch11,
            10,
            'PHONE_TASK',
            'Call {{trigger.firstName}} @ {{trigger.company}} #3',
            'Phone call attempt #3. Mention specific {{trigger.productType}} lighting technique.',
            10,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch11,
            LS_STEP.approvalTouch12,
            11,
            'SEND_EMAIL',
            'Special offer for {{trigger.company}} - this week only',
            'Hi {{trigger.firstName}},\n\nI have a special package deal for {{trigger.productType}} photography this month. Would love to discuss how it could work for {{trigger.company}}.\n\n[PACKAGE_LINK]\n\nMoshe',
            14,
          ),
          makeApprovalStep(
            LS_STEP.approvalTouch12,
            null,
            12,
            'SEND_EMAIL',
            'Is {{trigger.productType}} photography still a priority?',
            'Hi {{trigger.firstName}},\n\nI wanted to check in one last time. Is {{trigger.productType}} photography still a priority for {{trigger.company}}?\n\nIf the timing is not right, no worries at all. I will keep your info on file and you can reach out whenever you are ready.\n\nBest,\nMoshe Lerner\nImpression Photography | Montreal',
            21,
          ),
        ]),
        status: 'DRAFT',
        position: 1,
        workflowId: LEAD_SEQUENCE_WORKFLOW_ID,
      },
    ])
    .returning('*')
    .execute();

  // ========================================
  // WORKFLOW B: Execute Approved Touch
  // ========================================
  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflow`, [
      'id',
      'name',
      'lastPublishedVersionId',
      'statuses',
      'position',
      'createdBySource',
      'createdByWorkspaceMemberId',
      'createdByName',
      'createdByContext',
      'updatedBySource',
      'updatedByWorkspaceMemberId',
      'updatedByName',
    ])
    .orIgnore()
    .values([
      {
        id: EXECUTE_TOUCH_WORKFLOW_ID,
        name: 'Execute Approved Touch',
        lastPublishedVersionId: EXECUTE_TOUCH_VERSION_ID,
        statuses: ['DRAFT'],
        position: 3,
        createdBySource: FieldActorSource.SYSTEM,
        createdByWorkspaceMemberId: null,
        createdByName: 'System',
        createdByContext: {},
        updatedBySource: FieldActorSource.SYSTEM,
        updatedByWorkspaceMemberId: null,
        updatedByName: 'System',
      },
    ])
    .returning('*')
    .execute();

  await entityManager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.workflowVersion`, [
      'id',
      'name',
      'trigger',
      'steps',
      'status',
      'position',
      'workflowId',
    ])
    .orIgnore()
    .values([
      {
        id: EXECUTE_TOUCH_VERSION_ID,
        name: 'v1',
        trigger: JSON.stringify({
          name: 'On Approval Status Change',
          type: 'DATABASE_EVENT',
          settings: {
            eventName: 'approval.updated',
            outputSchema: {},
          },
          nextStepIds: [ET_STEP.findApproval],
        }),
        steps: JSON.stringify([
          // Step 1: Find the updated approval record
          {
            id: ET_STEP.findApproval,
            name: 'Find Approval Record',
            type: 'FIND_RECORDS',
            valid: true,
            settings: {
              input: {
                objectName: 'approval',
                filter: {
                  gqlOperationFilter: [
                    {
                      id: { eq: '{{trigger.recordId}}' },
                    },
                  ],
                },
                limit: 1,
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: true },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [ET_STEP.ifApproved],
          },
          // Step 2: Check if status is APPROVED
          {
            id: ET_STEP.ifApproved,
            name: 'Is Approved?',
            type: 'IF_ELSE',
            valid: true,
            settings: {
              input: {
                stepFilterGroups: [
                  {
                    id: FILTER_IDS.approvedFilterGroup,
                    logicalOperator: 'AND',
                  },
                ],
                stepFilters: [
                  {
                    id: FILTER_IDS.approvedFilter,
                    type: 'TEXT',
                    stepOutputKey: `{{${ET_STEP.findApproval}.first.approvalStatus}}`,
                    operand: 'IS',
                    value: 'APPROVED',
                    stepFilterGroupId: FILTER_IDS.approvedFilterGroup,
                  },
                ],
                branches: [
                  {
                    id: FILTER_IDS.approvedBranchYes,
                    filterGroupId: FILTER_IDS.approvedFilterGroup,
                    nextStepIds: [ET_STEP.ifActionType],
                  },
                  {
                    id: FILTER_IDS.approvedBranchNo,
                    nextStepIds: [],
                  },
                ],
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: null,
          },
          // Step 3: Route by action type
          {
            id: ET_STEP.ifActionType,
            name: 'Route by Action Type',
            type: 'IF_ELSE',
            valid: true,
            settings: {
              input: {
                stepFilterGroups: [
                  { id: FILTER_IDS.emailFilterGroup, logicalOperator: 'AND' },
                  {
                    id: FILTER_IDS.linkedinFilterGroup,
                    logicalOperator: 'AND',
                  },
                  { id: FILTER_IDS.smsFilterGroup, logicalOperator: 'AND' },
                ],
                stepFilters: [
                  {
                    id: FILTER_IDS.emailFilter,
                    type: 'TEXT',
                    stepOutputKey: `{{${ET_STEP.findApproval}.first.actionType}}`,
                    operand: 'IS',
                    value: 'SEND_EMAIL',
                    stepFilterGroupId: FILTER_IDS.emailFilterGroup,
                  },
                  {
                    id: FILTER_IDS.linkedinFilter,
                    type: 'TEXT',
                    stepOutputKey: `{{${ET_STEP.findApproval}.first.actionType}}`,
                    operand: 'CONTAINS',
                    value: 'LINKEDIN',
                    stepFilterGroupId: FILTER_IDS.linkedinFilterGroup,
                  },
                  {
                    id: FILTER_IDS.smsFilter,
                    type: 'TEXT',
                    stepOutputKey: `{{${ET_STEP.findApproval}.first.actionType}}`,
                    operand: 'IS',
                    value: 'SMS_NOTIFY',
                    stepFilterGroupId: FILTER_IDS.smsFilterGroup,
                  },
                ],
                branches: [
                  {
                    id: FILTER_IDS.emailBranch,
                    filterGroupId: FILTER_IDS.emailFilterGroup,
                    nextStepIds: [ET_STEP.sendEmail],
                  },
                  {
                    id: FILTER_IDS.linkedinBranch,
                    filterGroupId: FILTER_IDS.linkedinFilterGroup,
                    nextStepIds: [ET_STEP.httpLinkedIn],
                  },
                  {
                    id: FILTER_IDS.smsBranch,
                    filterGroupId: FILTER_IDS.smsFilterGroup,
                    nextStepIds: [ET_STEP.httpSms],
                  },
                  {
                    id: FILTER_IDS.phoneBranch,
                    nextStepIds: [ET_STEP.createPhoneTask],
                  },
                ],
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: null,
          },
          // Step 4: Send Email
          {
            id: ET_STEP.sendEmail,
            name: 'Send Email',
            type: 'SEND_EMAIL',
            valid: false,
            settings: {
              input: {
                connectedAccountId: '',
                recipients: {
                  to: `{{${ET_STEP.findApproval}.first.recipientEmail}}`,
                },
                subject: `{{${ET_STEP.findApproval}.first.emailSubject}}`,
                body: `{{${ET_STEP.findApproval}.first.emailBody}}`,
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: true },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [ET_STEP.updateCompleted],
          },
          // Step 5: HTTP Request (LinkedIn)
          {
            id: ET_STEP.httpLinkedIn,
            name: 'LinkedIn via n8n',
            type: 'HTTP_REQUEST',
            valid: true,
            settings: {
              input: {
                url: 'https://YOUR_N8N_INSTANCE/webhook/linkedin',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: {
                  action: `{{${ET_STEP.findApproval}.first.actionType}}`,
                  leadName: `{{${ET_STEP.findApproval}.first.leadName}}`,
                  companyName: `{{${ET_STEP.findApproval}.first.companyName}}`,
                  message: `{{${ET_STEP.findApproval}.first.emailBody}}`,
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [ET_STEP.updateCompleted],
          },
          // Step 6: HTTP Request (SMS)
          {
            id: ET_STEP.httpSms,
            name: 'SMS via n8n',
            type: 'HTTP_REQUEST',
            valid: true,
            settings: {
              input: {
                url: 'https://YOUR_N8N_INSTANCE/webhook/sms-notify',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: {
                  leadName: `{{${ET_STEP.findApproval}.first.leadName}}`,
                  companyName: `{{${ET_STEP.findApproval}.first.companyName}}`,
                  message: `{{${ET_STEP.findApproval}.first.emailBody}}`,
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [ET_STEP.updateCompleted],
          },
          // Step 7: Create Phone Task
          {
            id: ET_STEP.createPhoneTask,
            name: 'Create Phone Task',
            type: 'CREATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'task',
                objectRecord: {
                  title: `{{${ET_STEP.findApproval}.first.emailSubject}}`,
                  status: 'TODO',
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: false },
                continueOnFailure: { value: true },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: [ET_STEP.updateCompleted],
          },
          // Step 8: Update approval status to COMPLETED
          {
            id: ET_STEP.updateCompleted,
            name: 'Mark as Completed',
            type: 'UPDATE_RECORD',
            valid: true,
            settings: {
              input: {
                objectName: 'approval',
                objectRecordId: `{{${ET_STEP.findApproval}.first.id}}`,
                objectRecord: {
                  approvalStatus: 'COMPLETED',
                },
              },
              outputSchema: {},
              errorHandlingOptions: {
                retryOnFailure: { value: true },
                continueOnFailure: { value: false },
              },
            },
            __typename: 'WorkflowAction',
            nextStepIds: null,
          },
        ]),
        status: 'DRAFT',
        position: 1,
        workflowId: EXECUTE_TOUCH_WORKFLOW_ID,
      },
    ])
    .returning('*')
    .execute();
};
