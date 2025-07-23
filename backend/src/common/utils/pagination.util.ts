import { PaginatedResult, PaginationDto } from '../dto/pagination.dto';

export class PaginationUtil {
  static async paginate<T>(
    findManyFn: () => Promise<T[]>,
    countFn: () => Promise<number>,
    pagination: PaginationDto,
  ): Promise<PaginatedResult<T>> {
    const { page = 1, limit = 10 } = pagination;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([findManyFn(), countFn()]);

    const totalPages = Math.ceil(total / limit);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  static getPaginationParams(pagination: PaginationDto) {
    const { page = 1, limit = 10, sortBy, sortOrder = 'asc' } = pagination;
    const skip = (page - 1) * limit;
    const take = limit;

    const orderBy = sortBy ? { [sortBy]: sortOrder } : undefined;

    return { skip, take, orderBy };
  }

  static buildSearchCondition(search?: string, fields: string[] = []) {
    if (!search || fields.length === 0) {
      return {};
    }

    return {
      OR: fields.map((field) => ({
        [field]: {
          contains: search,
          mode: 'insensitive' as const,
        },
      })),
    };
  }
}
