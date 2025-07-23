import {
  IsOptional,
  IsString,
  IsDateString,
  IsEnum,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsSafeString, IsUUIDv4 } from '../validators/custom.validator';

export class BaseEntityDto {
  @IsUUIDv4()
  id: string;

  @IsDateString()
  createdAt: string;

  @IsDateString()
  updatedAt: string;
}

export class CreateEntityDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeString()
  description?: string;
}

export class UpdateEntityDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @IsSafeString()
  description?: string;
}

export class IdParamDto {
  @IsUUIDv4()
  id: string;
}

export class ArchiveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsSafeString()
  reason?: string;
}

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class SearchDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  @MinLength(2, { message: 'Search term must be at least 2 characters long' })
  @MaxLength(100, { message: 'Search term cannot exceed 100 characters' })
  @IsSafeString()
  q?: string;

  @IsOptional()
  @IsEnum(SortOrder)
  order?: SortOrder = SortOrder.ASC;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sortBy?: string;
}
