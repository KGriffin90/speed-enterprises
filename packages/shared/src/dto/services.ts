import { z } from 'zod';
import { ServiceSchema } from '../config';

export const CreateServiceDto = ServiceSchema.omit({ id: true });
export type CreateServiceDto = z.infer<typeof CreateServiceDto>;

export const UpdateServiceDto = CreateServiceDto.partial();
export type UpdateServiceDto = z.infer<typeof UpdateServiceDto>;
