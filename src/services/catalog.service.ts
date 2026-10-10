import type { Office, Prisma, Service } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type {
  CreateOfficeBody,
  CreateRequirementBody,
  CreateServiceBody,
  LinkRequirementBody,
  ListOfficesQuery,
  ListServicesQuery,
  OfficeServiceBody,
  UpdateOfficeBody,
  UpdateRequirementBody,
  UpdateServiceBody,
} from '../schemas/catalog.schema.js';
import { NotFoundError } from '../utils/errors.js';
import { type Lang, pick, pickOptional } from '../utils/language.js';
import { pageMeta, paginate } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';


function toServiceSummary(service: Service, lang: Lang) {
  return {
    id: service.id,
    slug: service.slug,
    name: pick(lang, service.nameEn, service.nameAm),
    description: pickOptional(lang, service.descriptionEn, service.descriptionAm),
    category: service.category,
    feeInfo: service.feeInfo,
  };
}

function toOfficeSummary(office: Office, lang: Lang) {
  return {
    id: office.id,
    name: pick(lang, office.nameEn, office.nameAm),
    address: pickOptional(lang, office.addressEn, office.addressAm),
    city: office.city,
    slotTimes: office.slotTimes,
  };
}

export async function listServices(query: ListServicesQuery, lang: Lang) {
  const where: Prisma.ServiceWhereInput = {
    isActive: true,
    ...(query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {}),
    ...(query.search
      ? {
          OR: [
            { nameEn: { contains: query.search, mode: 'insensitive' } },
            { nameAm: { contains: query.search } },
            { descriptionEn: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.service.count({ where }),
    prisma.service.findMany({ where, orderBy: { nameEn: 'asc' }, ...paginate(query.page, query.limit) }),
  ]);

  return {
    items: rows.map((service) => toServiceSummary(service, lang)),
    meta: pageMeta(total, query.page, query.limit),
  };
}

export async function getService(id: string, lang: Lang) {
  const service = await prisma.service.findFirst({
    where: { id, isActive: true },
    include: {
      requirements: {
        where: { requirement: { isActive: true } },
        include: { requirement: true },
        orderBy: { isMandatory: 'desc' },
      },
      offices: {
        where: { office: { isActive: true } },
        include: { office: true },
      },
    },
  });
  if (!service) throw new NotFoundError('Service not found');

  return {
    ...toServiceSummary(service, lang),
    requirements: service.requirements.map((link) => ({
      id: link.id, // the checklist item id: uploads attach to this
      requirementId: link.requirementId,
      name: pick(lang, link.requirement.nameEn, link.requirement.nameAm),
      description: pickOptional(lang, link.requirement.descriptionEn, link.requirement.descriptionAm),
      isMandatory: link.isMandatory,
      notes: pickOptional(lang, link.notesEn, link.notesAm),
    })),
    offices: service.offices.map((link) => ({
      ...toOfficeSummary(link.office, lang),
      slotCapacity: link.slotCapacity,
    })),
  };
}

export async function listOffices(query: ListOfficesQuery, lang: Lang) {
  const offices = await prisma.office.findMany({
    where: {
      isActive: true,
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.serviceId ? { services: { some: { serviceId: query.serviceId, service: { isActive: true } } } } : {}),
    },
    orderBy: { nameEn: 'asc' },
  });
  return offices.map((office) => toOfficeSummary(office, lang));
}

// ───────────────────────── Admin writes ─────────────────────────
// Each write and its audit row share one transaction.

const normalizeSlots = (slots: string[]): string[] => [...new Set(slots)].sort();

const stripUndefined = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

export async function createService(body: CreateServiceBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const service = await tx.service.create({ data: stripUndefined(body) as Prisma.ServiceCreateInput });
    await recordAudit({ actorId, action: 'SERVICE_CREATED', entityType: 'Service', entityId: service.id }, tx);
    return service;
  });
}

export async function updateService(id: string, body: UpdateServiceBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const service = await tx.service.update({ where: { id }, data: stripUndefined(body) as Prisma.ServiceUpdateInput });
    await recordAudit(
      {
        actorId,
        action: body.isActive === false ? 'SERVICE_DEACTIVATED' : 'SERVICE_UPDATED',
        entityType: 'Service',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
      tx,
    );
    return service;
  });
}

export async function createRequirement(body: CreateRequirementBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.create({ data: stripUndefined(body) as Prisma.RequirementCreateInput });
    await recordAudit({ actorId, action: 'REQUIREMENT_CREATED', entityType: 'Requirement', entityId: requirement.id }, tx);
    return requirement;
  });
}

export async function updateRequirement(id: string, body: UpdateRequirementBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.update({ where: { id }, data: stripUndefined(body) as Prisma.RequirementUpdateInput });
    await recordAudit(
      {
        actorId,
        action: body.isActive === false ? 'REQUIREMENT_DEACTIVATED' : 'REQUIREMENT_UPDATED',
        entityType: 'Requirement',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
      tx,
    );
    return requirement;
  });
}

export async function setServiceRequirement(
  serviceId: string,
  requirementId: string,
  body: LinkRequirementBody,
  actorId: string,
) {
  const [service, requirement] = await Promise.all([
    prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } }),
    prisma.requirement.findUnique({ where: { id: requirementId }, select: { id: true } }),
  ]);
  if (!service) throw new NotFoundError('Service not found');
  if (!requirement) throw new NotFoundError('Requirement not found');

  return prisma.$transaction(async (tx) => {
    const sanitizedBody = stripUndefined(body) as Partial<LinkRequirementBody>;
    const link = await tx.serviceRequirement.upsert({
      where: { serviceId_requirementId: { serviceId, requirementId } },
      update: sanitizedBody as Prisma.ServiceRequirementUpdateInput,
      create: {
        serviceId,
        requirementId,
        ...sanitizedBody,
        notesEn: body.notesEn ?? null,
        notesAm: body.notesAm ?? null,
      },
    });
    await recordAudit(
      { actorId, action: 'SERVICE_REQUIREMENT_SET', entityType: 'Service', entityId: serviceId, metadata: { requirementId } },
      tx,
    );
    return link;
  });
}

export async function removeServiceRequirement(serviceId: string, requirementId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    // If citizens already uploaded documents against this item, the foreign key blocks the delete (409)
    const link = await tx.serviceRequirement.delete({
      where: { serviceId_requirementId: { serviceId, requirementId } },
    });
    await recordAudit(
      { actorId, action: 'SERVICE_REQUIREMENT_REMOVED', entityType: 'Service', entityId: serviceId, metadata: { requirementId } },
      tx,
    );
    return link;
  });
}

export async function createOffice(body: CreateOfficeBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const office = await tx.office.create({
      data: stripUndefined({ ...body, slotTimes: normalizeSlots(body.slotTimes) }) as Prisma.OfficeCreateInput,
    });
    await recordAudit({ actorId, action: 'OFFICE_CREATED', entityType: 'Office', entityId: office.id }, tx);
    return office;
  });
}

export async function updateOffice(id: string, body: UpdateOfficeBody, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const office = await tx.office.update({
      where: { id },
      data: stripUndefined({
        ...body,
        ...(body.slotTimes ? { slotTimes: normalizeSlots(body.slotTimes) } : {}),
      }) as Prisma.OfficeUpdateInput,
    });
    await recordAudit(
      {
        actorId,
        action: body.isActive === false ? 'OFFICE_DEACTIVATED' : 'OFFICE_UPDATED',
        entityType: 'Office',
        entityId: id,
        metadata: { fields: Object.keys(body) },
      },
      tx,
    );
    return office;
  });
}

export async function setOfficeService(officeId: string, serviceId: string, body: OfficeServiceBody, actorId: string) {
  const [office, service] = await Promise.all([
    prisma.office.findUnique({ where: { id: officeId }, select: { id: true } }),
    prisma.service.findUnique({ where: { id: serviceId }, select: { id: true } }),
  ]);
  if (!office) throw new NotFoundError('Office not found');
  if (!service) throw new NotFoundError('Service not found');

  return prisma.$transaction(async (tx) => {
    const sanitizedBody = stripUndefined(body) as Partial<OfficeServiceBody>;
    const link = await tx.officeService.upsert({
      where: { officeId_serviceId: { officeId, serviceId } },
      update: sanitizedBody as Prisma.OfficeServiceUpdateInput,
      create: {
        officeId,
        serviceId,
        ...sanitizedBody,
        notesEn: 'notesEn' in body ? (body.notesEn ?? null) : undefined,
        notesAm: 'notesAm' in body ? (body.notesAm ?? null) : undefined,
      },
    });
    await recordAudit(
      { actorId, action: 'OFFICE_SERVICE_SET', entityType: 'Office', entityId: officeId, metadata: { serviceId, ...body } },
      tx,
    );
    return link;
  });
}

export async function removeOfficeService(officeId: string, serviceId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const link = await tx.officeService.delete({ where: { officeId_serviceId: { officeId, serviceId } } });
    await recordAudit(
      { actorId, action: 'OFFICE_SERVICE_REMOVED', entityType: 'Office', entityId: officeId, metadata: { serviceId } },
      tx,
    );
    return link;
  });
}