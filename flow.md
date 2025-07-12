# Educational Management System - Complete Development Roadmap

## Tech Stack & Architecture Setup

### Development Environment

```
Backend Stack:
├── Node.js 18+ + TypeScript
├── NestJS Framework
├── PostgreSQL Database
├── Prisma ORM
├── Redis for Caching
├── JWT Authentication
└── WebSocket (Socket.io)

Frontend Stack:
├── Next.js 14 (App Router)
├── TypeScript
├── Tailwind CSS
├── Shadcn/ui Components
├── React Query (TanStack Query)
├── Zustand (State Management)
└── React Hook Form + Zod

Mobile Development:
├── React Native (Expo)
├── TypeScript
├── NativeBase/Tamagui
└── React Navigation

DevOps & Deployment:
├── Docker + Docker Compose
├── GitHub Actions CI/CD
├── Vercel/Railway Deployment
├── AWS S3 (File Storage)
└── Cloudflare (CDN + SSL)

Development Tools:
├── GitHub Copilot Pro
├── Cursor IDE
├── Prisma Studio
├── Postman/Thunder Client
└── ESLint + Prettier
```

## Phase 1: Foundation Setup (Bulan 1-2, 8 Minggu)

### Week 1-2: Project Architecture & Setup

#### Backend Foundation

```typescript
// Project Structure
src/
├── main.ts
├── app.module.ts
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── tenant.guard.ts
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── tenant.decorator.ts
│   ├── interceptors/
│   │   ├── tenant.interceptor.ts
│   │   └── transform.interceptor.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   └── pipes/
│       └── validation.pipe.ts
├── config/
│   ├── database.config.ts
│   ├── auth.config.ts
│   └── app.config.ts
└── modules/
    ├── auth/
    ├── users/
    ├── tenants/
    ├── schools/
    ├── students/
    ├── parents/
    ├── academic/
    ├── notifications/
    ├── white-label/
    └── analytics/
```

#### Database Schema Design

```prisma
// schema.prisma - Core Entities
model Tenant {
  id               String   @id @default(cuid())
  name             String
  subdomain        String   @unique
  customDomain     String?  @unique
  whiteLabelPlan   WhiteLabelPlan @default(NONE)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  // Relations
  schools          School[]
  users            User[]
  whiteLabelConfig WhiteLabelConfig?
  subscriptions    Subscription[]

  @@map("tenants")
}

model School {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  email       String
  phone       String
  address     String
  nisp        String?  // Nomor Induk Sekolah Pokok
  npsn        String?  // Nomor Pokok Sekolah Nasional
  schoolType  SchoolType
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  users       User[]
  students    Student[]
  grades      Grade[]
  classes     Class[]
  academicYears AcademicYear[]

  @@map("schools")
}

model User {
  id           String   @id @default(cuid())
  tenantId     String
  schoolId     String?
  email        String   @unique
  password     String
  firstName    String
  lastName     String
  phone        String?
  role         UserRole
  isActive     Boolean  @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // Relations
  tenant       Tenant   @relation(fields: [tenantId], references: [id])
  school       School?  @relation(fields: [schoolId], references: [id])
  studentParents StudentParent[]
  teacherClasses TeacherClass[]

  @@map("users")
}

model Student {
  id           String   @id @default(cuid())
  schoolId     String
  nisn         String?  @unique // Nomor Induk Siswa Nasional
  nis          String   // Nomor Induk Sekolah
  firstName    String
  lastName     String
  gender       Gender
  birthDate    DateTime
  birthPlace   String
  address      String
  phone        String?
  email        String?
  religion     Religion
  bloodType    BloodType?
  isActive     Boolean  @default(true)
  enrollmentDate DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  // Relations
  school       School   @relation(fields: [schoolId], references: [id])
  parents      StudentParent[]
  enrollments  Enrollment[]
  attendances  Attendance[]
  grades       StudentGrade[]

  @@unique([schoolId, nis])
  @@map("students")
}

enum UserRole {
  PLATFORM_OWNER
  TENANT_OWNER
  SCHOOL_ADMIN
  TEACHER
  PARENT
  STUDENT
  STAFF
}

enum SchoolType {
  KB    // Kelompok Bermain
  TK    // Taman Kanak-kanak
  SD    // Sekolah Dasar
  SMP   // Sekolah Menengah Pertama
  SMA   // Sekolah Menengah Atas
  SMK   // Sekolah Menengah Kejuruan
}

enum WhiteLabelPlan {
  NONE
  BASIC
  PREMIUM
  ENTERPRISE
}
```

#### Authentication & Authorization

```typescript
// auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(password, user.password))) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any) {
    const payload = {
      email: user.email,
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: user,
    };
  }

  async register(createUserDto: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    return this.usersService.create({
      ...createUserDto,
      password: hashedPassword,
    });
  }
}

// guards/tenant.guard.ts
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Extract tenant from subdomain or custom domain
    const host = request.get("host");
    const tenantId = this.extractTenantFromHost(host);

    // Verify user belongs to tenant
    if (user.tenantId !== tenantId) {
      throw new ForbiddenException("Access denied for this tenant");
    }

    return true;
  }

  private extractTenantFromHost(host: string): string {
    // Logic to extract tenant from domain/subdomain
    // Implementation based on white-label configuration
  }
}
```

### Week 3-4: Multi-Tenant Architecture

#### Tenant Management System

```typescript
// tenants/tenants.service.ts
@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async create(createTenantDto: CreateTenantDto) {
    return this.prisma.tenant.create({
      data: {
        ...createTenantDto,
        whiteLabelConfig: {
          create: {
            primaryColor: "#1e40af",
            secondaryColor: "#64748b",
            logoUrl: null,
            faviconUrl: null,
            customCss: null,
          },
        },
      },
      include: {
        whiteLabelConfig: true,
      },
    });
  }

  async findByDomain(domain: string) {
    return this.prisma.tenant.findFirst({
      where: {
        OR: [{ subdomain: domain }, { customDomain: domain }],
      },
      include: {
        whiteLabelConfig: true,
        schools: true,
      },
    });
  }

  async updateWhiteLabelConfig(tenantId: string, config: UpdateWhiteLabelDto) {
    return this.prisma.whiteLabelConfig.upsert({
      where: { tenantId },
      update: config,
      create: {
        tenantId,
        ...config,
      },
    });
  }
}

// DTOs
export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/)
  subdomain: string;

  @IsOptional()
  @IsString()
  customDomain?: string;

  @IsEnum(WhiteLabelPlan)
  @IsOptional()
  whiteLabelPlan?: WhiteLabelPlan = WhiteLabelPlan.NONE;
}
```

### Week 5-6: User Management & RBAC

#### Role-Based Access Control

```typescript
// users/users.service.ts
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    return this.prisma.user.create({
      data: createUserDto,
      include: {
        tenant: true,
        school: true,
      },
    });
  }

  async findByRole(tenantId: string, role: UserRole) {
    return this.prisma.user.findMany({
      where: {
        tenantId,
        role,
        isActive: true,
      },
      include: {
        school: true,
      },
    });
  }

  async assignToSchool(userId: string, schoolId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { schoolId },
    });
  }
}

// Decorators for authorization
export const Roles = (...roles: UserRole[]) => SetMetadata("roles", roles);
export const RequireSchool = () => SetMetadata("requireSchool", true);
export const CurrentUser = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
```

### Week 7-8: Basic Frontend Setup

#### Next.js Application Structure

```typescript
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <TenantProvider>
            <AuthProvider>{children}</AuthProvider>
          </TenantProvider>
        </Providers>
      </body>
    </html>
  );
}

// components/providers/tenant-provider.tsx
("use client");

import { createContext, useContext, useEffect, useState } from "react";

interface TenantContextType {
  tenant: Tenant | null;
  whiteLabelConfig: WhiteLabelConfig | null;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  tenant: null,
  whiteLabelConfig: null,
  isLoading: true,
});

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [whiteLabelConfig, setWhiteLabelConfig] = useState<WhiteLabelConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fetch tenant info based on domain
    fetchTenantInfo();
  }, []);

  const fetchTenantInfo = async () => {
    try {
      const response = await fetch("/api/tenant/current");
      const data = await response.json();
      setTenant(data.tenant);
      setWhiteLabelConfig(data.whiteLabelConfig);
    } catch (error) {
      console.error("Failed to fetch tenant info:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TenantContext.Provider value={{ tenant, whiteLabelConfig, isLoading }}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
```

#### Authentication Components

```typescript
// components/auth/login-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenant } from "@/components/providers/tenant-provider";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { whiteLabelConfig } = useTenant();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem("token", data.access_token);
        router.push("/dashboard");
      }
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card
      className="w-full max-w-md mx-auto"
      style={{
        "--primary": whiteLabelConfig?.primaryColor || "#1e40af",
        "--secondary": whiteLabelConfig?.secondaryColor || "#64748b",
      }}
    >
      <CardHeader>
        <CardTitle>Login</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Logging in..." : "Login"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

## Phase 2: Core Features Development (Bulan 3-6, 16 Minggu)

### Week 9-12: Student Management System

#### Student CRUD Operations

```typescript
// students/students.service.ts
@Injectable()
export class StudentsService {
  constructor(private prisma: PrismaService, private nisn: NisnService) {}

  async create(createStudentDto: CreateStudentDto) {
    // Generate NIS if not provided
    const nis = createStudentDto.nis || (await this.generateNIS(createStudentDto.schoolId));

    return this.prisma.student.create({
      data: {
        ...createStudentDto,
        nis,
      },
      include: {
        school: true,
        parents: {
          include: {
            parent: true,
          },
        },
      },
    });
  }

  async findByNISN(nisn: string) {
    return this.prisma.student.findUnique({
      where: { nisn },
      include: {
        school: true,
        enrollments: {
          include: {
            grade: true,
            class: true,
            academicYear: true,
          },
          orderBy: { enrollmentDate: "desc" },
        },
        parents: {
          include: {
            parent: true,
          },
        },
      },
    });
  }

  async getAcademicHistory(studentId: string) {
    return this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        grade: true,
        class: true,
        academicYear: true,
        previousGrade: true,
      },
      orderBy: { enrollmentDate: "asc" },
    });
  }

  private async generateNIS(schoolId: string): Promise<string> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    const count = await this.prisma.student.count({
      where: { schoolId },
    });

    return `${school.nisp || "000"}${(count + 1).toString().padStart(4, "0")}`;
  }
}

// DTOs
export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsOptional()
  @IsString()
  nisn?: string;

  @IsOptional()
  @IsString()
  nis?: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsDateString()
  birthDate: string;

  @IsString()
  @IsNotEmpty()
  birthPlace: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(Religion)
  religion: Religion;

  @IsOptional()
  @IsEnum(BloodType)
  bloodType?: BloodType;
}
```

#### Student Enrollment System

```typescript
// academic/enrollment.service.ts
@Injectable()
export class EnrollmentService {
  constructor(private prisma: PrismaService) {}

  async enrollStudent(enrollmentDto: CreateEnrollmentDto) {
    // Check if student is already enrolled for the academic year
    const existingEnrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId: enrollmentDto.studentId,
        academicYearId: enrollmentDto.academicYearId,
        status: "ACTIVE",
      },
    });

    if (existingEnrollment) {
      throw new ConflictException("Student already enrolled for this academic year");
    }

    // Get previous enrollment for promotion tracking
    const previousEnrollment = await this.getPreviousEnrollment(enrollmentDto.studentId);

    return this.prisma.enrollment.create({
      data: {
        ...enrollmentDto,
        isPromotion: !!previousEnrollment,
        previousGradeId: previousEnrollment?.gradeId,
        promotionType: this.determinePromotionType(
          previousEnrollment?.gradeId,
          enrollmentDto.gradeId
        ),
        enrollmentDate: new Date(),
        status: "ACTIVE",
      },
      include: {
        student: true,
        grade: true,
        class: true,
        academicYear: true,
        previousGrade: true,
      },
    });
  }

  async promoteStudent(
    studentId: string,
    newGradeId: string,
    newClassId: string,
    academicYearId: string,
    promotionType: PromotionType = PromotionType.REGULAR
  ) {
    // Complete current enrollment
    const currentEnrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        status: "ACTIVE",
      },
    });

    if (currentEnrollment) {
      await this.prisma.enrollment.update({
        where: { id: currentEnrollment.id },
        data: {
          status: "COMPLETED",
          completionDate: new Date(),
        },
      });
    }

    // Create new enrollment
    return this.enrollStudent({
      studentId,
      gradeId: newGradeId,
      classId: newClassId,
      academicYearId,
    });
  }

  async getStudentAcademicJourney(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        grade: true,
        class: true,
        academicYear: true,
        previousGrade: true,
      },
      orderBy: { enrollmentDate: "asc" },
    });

    return {
      totalYears: enrollments.length,
      promotions: enrollments.filter((e) => e.isPromotion).length,
      retentions: enrollments.filter((e) => e.promotionType === "RETAINED").length,
      accelerations: enrollments.filter((e) => e.promotionType === "ACCELERATED").length,
      timeline: enrollments.map((e) => ({
        year: e.academicYear.name,
        grade: e.grade.name,
        class: e.class.name,
        promotionType: e.promotionType,
        gpa: e.finalGPA,
        status: e.status,
      })),
    };
  }

  private determinePromotionType(
    previousGradeId: string | null,
    currentGradeId: string
  ): PromotionType {
    if (!previousGradeId) return PromotionType.REGULAR;

    // Logic to determine if it's regular, accelerated, or retention
    // This would include grade level comparison
    return PromotionType.REGULAR;
  }

  private async getPreviousEnrollment(studentId: string) {
    return this.prisma.enrollment.findFirst({
      where: { studentId },
      orderBy: { enrollmentDate: "desc" },
    });
  }
}
```

### Week 13-16: Academic Management

#### Grade & Class Management

```typescript
// academic/grades.service.ts
@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  async create(createGradeDto: CreateGradeDto) {
    return this.prisma.grade.create({
      data: createGradeDto,
      include: {
        subjects: true,
        classes: true,
      },
    });
  }

  async getBySchoolType(schoolType: SchoolType) {
    const gradeMapping = {
      [SchoolType.KB]: ["KB"],
      [SchoolType.TK]: ["TK A", "TK B"],
      [SchoolType.SD]: ["Kelas 1", "Kelas 2", "Kelas 3", "Kelas 4", "Kelas 5", "Kelas 6"],
      [SchoolType.SMP]: ["Kelas 7", "Kelas 8", "Kelas 9"],
      [SchoolType.SMA]: ["Kelas 10", "Kelas 11", "Kelas 12"],
      [SchoolType.SMK]: ["Kelas 10", "Kelas 11", "Kelas 12"],
    };

    return gradeMapping[schoolType] || [];
  }

  async createDefaultGradesForSchool(schoolId: string, schoolType: SchoolType) {
    const gradeNames = await this.getBySchoolType(schoolType);
    const grades = [];

    for (const [index, name] of gradeNames.entries()) {
      const grade = await this.prisma.grade.create({
        data: {
          schoolId,
          name,
          level: index + 1,
          schoolType,
        },
      });
      grades.push(grade);
    }

    return grades;
  }
}

// academic/classes.service.ts
@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  async create(createClassDto: CreateClassDto) {
    return this.prisma.class.create({
      data: createClassDto,
      include: {
        grade: true,
        homeRoomTeacher: true,
        students: {
          include: {
            student: true,
          },
        },
      },
    });
  }

  async assignHomeRoomTeacher(classId: string, teacherId: string) {
    return this.prisma.class.update({
      where: { id: classId },
      data: { homeRoomTeacherId: teacherId },
      include: {
        homeRoomTeacher: true,
      },
    });
  }

  async getClassStudents(classId: string, academicYearId: string) {
    return this.prisma.enrollment.findMany({
      where: {
        classId,
        academicYearId,
        status: "ACTIVE",
      },
      include: {
        student: true,
        grade: true,
      },
      orderBy: {
        student: {
          firstName: "asc",
        },
      },
    });
  }
}
```

### Week 17-20: Parent Portal Foundation

#### Parent Authentication & Multi-Child Support

```typescript
// parents/parents.service.ts
@Injectable()
export class ParentsService {
  constructor(private prisma: PrismaService, private notificationService: NotificationService) {}

  async create(createParentDto: CreateParentDto) {
    return this.prisma.user.create({
      data: {
        ...createParentDto,
        role: UserRole.PARENT,
      },
      include: {
        studentParents: {
          include: {
            student: {
              include: {
                school: true,
                enrollments: {
                  where: { status: "ACTIVE" },
                  include: {
                    grade: true,
                    class: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  async linkToStudent(parentId: string, studentId: string, relationship: ParentRelationship) {
    return this.prisma.studentParent.create({
      data: {
        parentId,
        studentId,
        relationship,
        isPrimary: false, // Set primary contact separately
      },
      include: {
        parent: true,
        student: true,
      },
    });
  }

  async getParentChildren(parentId: string) {
    return this.prisma.studentParent.findMany({
      where: { parentId },
      include: {
        student: {
          include: {
            school: true,
            enrollments: {
              where: { status: "ACTIVE" },
              include: {
                grade: true,
                class: true,
                academicYear: true,
              },
            },
          },
        },
      },
    });
  }

  async updateLanguagePreference(parentId: string, language: string) {
    return this.prisma.user.update({
      where: { id: parentId },
      data: {
        languagePreference: language,
      },
    });
  }

  async getChildAcademicHistory(parentId: string, studentId: string) {
    // Verify parent-child relationship
    const relationship = await this.prisma.studentParent.findFirst({
      where: { parentId, studentId },
    });

    if (!relationship) {
      throw new ForbiddenException("Access denied to student data");
    }

    return this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        grade: true,
        class: true,
        academicYear: true,
        previousGrade: true,
      },
      orderBy: { enrollmentDate: "asc" },
    });
  }
}

// parent-portal/parent-dashboard.tsx
("use client");

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Child {
  id: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    school: {
      name: string;
      schoolType: string;
    };
    enrollments: Array<{
      grade: { name: string };
      class: { name: string };
      academicYear: { name: string };
    }>;
  };
  relationship: string;
}

export function ParentDashboard() {
  const [children, setChildren] = useState<Child[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [currentChild, setCurrentChild] = useState<Child | null>(null);

  useEffect(() => {
    fetchChildren();
  }, []);

  useEffect(() => {
    if (selectedChild && children.length > 0) {
      const child = children.find((c) => c.student.id === selectedChild);
      setCurrentChild(child || null);
    }
  }, [selectedChild, children]);

  const fetchChildren = async () => {
    try {
      const response = await fetch("/api/parents/children");
      const data = await response.json();
      setChildren(data);
      if (data.length > 0) {
        setSelectedChild(data[0].student.id);
      }
    } catch (error) {
      console.error("Failed to fetch children:", error);
    }
  };

  if (children.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p>No children found. Please contact school administration.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Child Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Child</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedChild} onValueChange={setSelectedChild}>
            <SelectTrigger>
              <SelectValue placeholder="Select a child" />
            </SelectTrigger>
            <SelectContent>
              {children.map((child) => (
                <SelectItem key={child.student.id} value={child.student.id}>
                  {child.student.firstName} {child.student.lastName} - {child.student.school.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Child Information Tabs */}
      {currentChild && (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="academic">Academic</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="communication">Communication</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            {currentChild.student.school.schoolType === "KB" && (
              <TabsTrigger value="daily">Daily Activities</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview">
            <ChildOverview child={currentChild} />
          </TabsContent>

          <TabsContent value="academic">
            <AcademicHistory studentId={currentChild.student.id} />
          </TabsContent>

          <TabsContent value="attendance">
            <AttendanceView studentId={currentChild.student.id} />
          </TabsContent>

          <TabsContent value="communication">
            <CommunicationHub studentId={currentChild.student.id} />
          </TabsContent>

          <TabsContent value="payments">
            <PaymentOverview studentId={currentChild.student.id} />
          </TabsContent>

          {currentChild.student.school.schoolType === "KB" && (
            <TabsContent value="daily">
              <DailyActivities studentId={currentChild.student.id} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
```

#### Notification System for Parents

```typescript
// notifications/notification.service.ts
@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private whatsappService: WhatsAppService,
    private pushService: PushNotificationService
  ) {}

  async sendToParents(studentId: string, notification: CreateNotificationDto) {
    // Get student's parents
    const parents = await this.prisma.studentParent.findMany({
      where: { studentId },
      include: {
        parent: true,
        student: {
          include: {
            school: true,
            enrollments: {
              where: { status: "ACTIVE" },
              include: { grade: true },
            },
          },
        },
      },
    });

    // Determine notification strategy based on school type
    const schoolType = parents[0]?.student.school.schoolType;
    const strategy = this.getNotificationStrategy(schoolType);

    for (const parentRel of parents) {
      const parent = parentRel.parent;

      // Create notification record
      const notificationRecord = await this.prisma.notification.create({
        data: {
          ...notification,
          userId: parent.id,
          studentId,
          status: "PENDING",
        },
      });

      // Send via preferred channels based on strategy
      if (strategy.channels.includes("push")) {
        await this.sendPushNotification(parent.id, notification);
      }

      if (strategy.channels.includes("whatsapp") && parent.phone) {
        await this.sendWhatsAppNotification(parent.phone, notification, parent.languagePreference);
      }

      if (strategy.channels.includes("email") && parent.email) {
        await this.sendEmailNotification(parent.email, notification, parent.languagePreference);
      }

      // Update notification status
      await this.prisma.notification.update({
        where: { id: notificationRecord.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    }
  }

  private getNotificationStrategy(schoolType: SchoolType) {
    const strategies = {
      [SchoolType.KB]: {
        frequency: "high",
        channels: ["push", "whatsapp"],
        timing: ["07:30", "15:00", "19:00"],
        batchNonUrgent: false,
      },
      [SchoolType.TK]: {
        frequency: "high",
        channels: ["push", "whatsapp", "email"],
        timing: ["08:00", "15:00", "19:00"],
        batchNonUrgent: false,
      },
      [SchoolType.SD]: {
        frequency: "medium",
        channels: ["push", "email"],
        timing: ["08:00", "16:00", "20:00"],
        batchNonUrgent: true,
        digestTime: "19:00",
      },
      [SchoolType.SMP]: {
        frequency: "low",
        channels: ["email", "app"],
        timing: ["weekly"],
        batchNonUrgent: true,
        digestDay: "Friday",
      },
      [SchoolType.SMA]: {
        frequency: "minimal",
        channels: ["email", "app"],
        timing: ["monthly"],
        criticalOnly: true,
      },
    };

    return strategies[schoolType] || strategies[SchoolType.SD];
  }

  async sendDailyActivityUpdate(studentId: string, activities: DailyActivity[]) {
    const notification = {
      type: NotificationType.DAILY_ACTIVITY,
      title: "Daily Activity Update",
      message: "Your child's daily activities have been updated",
      data: { activities },
      priority: NotificationPriority.LOW,
    };

    await this.sendToParents(studentId, notification);
  }

  async sendAcademicAlert(studentId: string, alertType: string, details: any) {
    const notification = {
      type: NotificationType.ACADEMIC,
      title: `Academic Alert: ${alertType}`,
      message: "Please review your child's academic progress",
      data: { alertType, details },
      priority: NotificationPriority.HIGH,
    };

    await this.sendToParents(studentId, notification);
  }
}

// notifications/dto/create-notification.dto.ts
export class CreateNotificationDto {
  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsObject()
  @IsOptional()
  data?: any;

  @IsEnum(NotificationPriority)
  @IsOptional()
  priority?: NotificationPriority = NotificationPriority.MEDIUM;

  @IsBoolean()
  @IsOptional()
  requiresAction?: boolean = false;
}

enum NotificationType {
  ACADEMIC = "academic",
  ATTENDANCE = "attendance",
  BEHAVIORAL = "behavioral",
  FINANCIAL = "financial",
  DAILY_ACTIVITY = "daily_activity",
  EMERGENCY = "emergency",
  ADMINISTRATIVE = "administrative",
}

enum NotificationPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}
```

### Week 21-24: Basic White-Label System

#### White-Label Configuration

```typescript
// white-label/white-label.service.ts
@Injectable()
export class WhiteLabelService {
  constructor(
    private prisma: PrismaService,
    private fileService: FileService,
    private domainService: DomainService
  ) {}

  async updateConfiguration(tenantId: string, config: UpdateWhiteLabelConfigDto) {
    return this.prisma.whiteLabelConfig.upsert({
      where: { tenantId },
      update: config,
      create: {
        tenantId,
        ...config,
      },
    });
  }

  async uploadLogo(tenantId: string, file: Express.Multer.File) {
    const logoUrl = await this.fileService.upload(file, `tenants/${tenantId}/logo`);

    return this.prisma.whiteLabelConfig.upsert({
      where: { tenantId },
      update: { logoUrl },
      create: {
        tenantId,
        logoUrl,
        primaryColor: "#1e40af",
        secondaryColor: "#64748b",
      },
    });
  }

  async setCustomDomain(tenantId: string, domain: string) {
    // Validate domain ownership
    const isValid = await this.domainService.verifyOwnership(domain);
    if (!isValid) {
      throw new BadRequestException("Domain ownership verification failed");
    }

    // Setup SSL certificate
    await this.domainService.setupSSL(domain);

    // Update tenant configuration
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { customDomain: domain },
    });
  }

  async generateCustomCSS(config: WhiteLabelConfig): Promise<string> {
    return `
      :root {
        --primary: ${config.primaryColor};
        --secondary: ${config.secondaryColor};
        --primary-foreground: #ffffff;
        --secondary-foreground: #ffffff;
      }

      .btn-primary {
        background-color: var(--primary);
        border-color: var(--primary);
      }

      .btn-primary:hover {
        background-color: ${this.darkenColor(config.primaryColor, 10)};
        border-color: ${this.darkenColor(config.primaryColor, 10)};
      }

      .navbar-brand img {
        max-height: 40px;
        width: auto;
      }

      ${config.customCss || ""}
    `;
  }

  private darkenColor(color: string, amount: number): string {
    // Implementation to darken hex color
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * amount);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
    return (
      "#" +
      (
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
      )
        .toString(16)
        .slice(1)
    );
  }
}

// white-label/domain.service.ts
@Injectable()
export class DomainService {
  constructor(private configService: ConfigService) {}

  async verifyOwnership(domain: string): Promise<boolean> {
    const verificationToken = this.generateVerificationToken();

    // Store verification token
    await this.storePendingVerification(domain, verificationToken);

    // Check for TXT record
    const txtRecord = await this.checkTXTRecord(domain, verificationToken);
    if (txtRecord) return true;

    // Check for CNAME record
    const cnameRecord = await this.checkCNAMERecord(domain);
    if (cnameRecord) return true;

    // Check for file verification
    const fileVerification = await this.checkFileVerification(domain, verificationToken);
    if (fileVerification) return true;

    return false;
  }

  async setupSSL(domain: string): Promise<void> {
    // Let's Encrypt integration
    const certbot = spawn("certbot", [
      "certonly",
      "--webroot",
      "--webroot-path=/var/www/certbot",
      "--email",
      this.configService.get("ADMIN_EMAIL"),
      "--agree-tos",
      "--no-eff-email",
      "-d",
      domain,
    ]);

    return new Promise((resolve, reject) => {
      certbot.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SSL setup failed with code ${code}`));
        }
      });
    });
  }

  private generateVerificationToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  private async checkTXTRecord(domain: string, token: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(domain);
      return records.some((record) =>
        record.some((txt) => txt.includes(`education-platform-verify=${token}`))
      );
    } catch (error) {
      return false;
    }
  }

  private async checkCNAMERecord(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveCname(domain);
      return records.includes(this.configService.get("PLATFORM_DOMAIN"));
    } catch (error) {
      return false;
    }
  }

  private async checkFileVerification(domain: string, token: string): Promise<boolean> {
    try {
      const response = await fetch(`https://${domain}/.well-known/education-platform-verify.txt`);
      const content = await response.text();
      return content.trim() === token;
    } catch (error) {
      return false;
    }
  }
}
```

## Phase 3: Advanced Features (Bulan 7-10, 16 Minggu)

### Week 25-28: Enhanced Parent Portal Features

#### Daily Activity Tracking for KB/TK

```typescript
// daily-activities/daily-activities.service.ts
@Injectable()
export class DailyActivitiesService {
  constructor(
    private prisma: PrismaService,
    private fileService: FileService,
    private notificationService: NotificationService
  ) {}

  async createActivity(createActivityDto: CreateDailyActivityDto) {
    const activity = await this.prisma.dailyActivity.create({
      data: createActivityDto,
      include: {
        student: true,
        photos: true,
      },
    });

    // Send real-time notification to parents
    await this.notificationService.sendDailyActivityUpdate(activity.studentId, [activity]);

    return activity;
  }

  async uploadActivityPhoto(activityId: string, file: Express.Multer.File, caption?: string) {
    const photoUrl = await this.fileService.upload(file, `activities/${activityId}/photos`);

    return this.prisma.activityPhoto.create({
      data: {
        activityId,
        photoUrl,
        caption,
      },
    });
  }

  async getStudentDailyActivities(studentId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return this.prisma.dailyActivity.findMany({
      where: {
        studentId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: {
        photos: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async getDailySummary(studentId: string, date: Date) {
    const activities = await this.getStudentDailyActivities(studentId, date);

    const summary = {
      arrivalTime: activities.find((a) => a.type === "ARRIVAL")?.createdAt,
      departureTime: activities.find((a) => a.type === "DEPARTURE")?.createdAt,
      meals: activities.filter((a) => a.type === "MEAL").length,
      napDuration: this.calculateNapDuration(activities),
      activities: activities.filter((a) => a.type === "ACTIVITY").length,
      mood: this.calculateAverageMood(activities),
      photos: activities.reduce((total, a) => total + a.photos.length, 0),
      teacherNotes: activities.filter((a) => a.notes).map((a) => a.notes),
    };

    return summary;
  }

  async generateDailyReport(studentId: string, date: Date) {
    const summary = await this.getDailySummary(studentId, date);
    const activities = await this.getStudentDailyActivities(studentId, date);

    // Send comprehensive daily report to parents
    await this.notificationService.sendDailyReport(studentId, {
      date,
      summary,
      activities,
    });

    return { summary, activities };
  }

  private calculateNapDuration(activities: DailyActivity[]): number {
    const napStart = activities.find((a) => a.type === "NAP_START");
    const napEnd = activities.find((a) => a.type === "NAP_END");

    if (napStart && napEnd) {
      return Math.round((napEnd.createdAt.getTime() - napStart.createdAt.getTime()) / (1000 * 60));
    }

    return 0;
  }

  private calculateAverageMood(activities: DailyActivity[]): string {
    const moodActivities = activities.filter((a) => a.mood);
    if (moodActivities.length === 0) return "neutral";

    const moodScores = {
      very_happy: 5,
      happy: 4,
      neutral: 3,
      sad: 2,
      very_sad: 1,
    };

    const average =
      moodActivities.reduce((sum, a) => sum + moodScores[a.mood], 0) / moodActivities.length;

    if (average >= 4.5) return "very_happy";
    if (average >= 3.5) return "happy";
    if (average >= 2.5) return "neutral";
    if (average >= 1.5) return "sad";
    return "very_sad";
  }
}

// DTOs
export class CreateDailyActivityDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsEnum(ActivityType)
  type: ActivityType;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsEnum(MoodType)
  @IsOptional()
  mood?: MoodType;

  @IsObject()
  @IsOptional()
  metadata?: any; // For storing additional data like meal details, activity duration, etc.
}

enum ActivityType {
  ARRIVAL = "arrival",
  DEPARTURE = "departure",
  MEAL = "meal",
  SNACK = "snack",
  NAP_START = "nap_start",
  NAP_END = "nap_end",
  ACTIVITY = "activity",
  BATHROOM = "bathroom",
  HEALTH_CHECK = "health_check",
  INCIDENT = "incident",
  MILESTONE = "milestone",
}

enum MoodType {
  VERY_HAPPY = "very_happy",
  HAPPY = "happy",
  NEUTRAL = "neutral",
  SAD = "sad",
  VERY_SAD = "very_sad",
}
```

#### Multi-Language Support Implementation

```typescript
// i18n/i18n.service.ts
@Injectable()
export class I18nService {
  private translations: Map<string, any> = new Map();

  constructor() {
    this.loadTranslations();
  }

  private async loadTranslations() {
    // Load translation files
    const languages = ['id', 'en', 'zh'];

    for (const lang of languages) {
      const translations = await import(`../locales/${lang}.json`);
      this.translations.set(lang, translations.default);
    }
  }

  translate(key: string, lang: string, params?: Record<string, any>): string {
    const translations = this.translations.get(lang) || this.translations.get('id');
    let translation = this.getNestedValue(translations, key);

    if (!translation) {
      // Fallback to Indonesian
      const fallback = this.translations.get('id');
      translation = this.getNestedValue(fallback, key) || key;
    }

    // Replace parameters
    if (params) {
      Object.keys(params).forEach(param => {
        translation = translation.replace(`{{${param}}}`, params[param]);
      });
    }

    return translation;
  }

  private getNestedValue(obj: any, path: string): string {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  async translateNotification(
    notification: any,
    language: string
  ): Promise<any> {
    return {
      ...notification,
      title: this.translate(notification.titleKey || notification.title, language, notification.params),
      message: this.translate(notification.messageKey || notification.message, language, notification.params),
    };
  }
}

// locales/id.json
{
  "notifications": {
    "daily_activity": {
      "arrival": {
        "title": "{{childName}} Telah Tiba di Sekolah",
        "message": "{{childName}} tiba dengan selamat pada pukul {{time}}"
      },
      "meal": {
        "title": "Waktu Makan - {{childName}}",
        "message": "{{childName}} sedang makan {{mealType}}. {{notes}}"
      },
      "nap": {
        "title": "Waktu Tidur Siang - {{childName}}",
        "message": "{{childName}} mulai tidur siang pada pukul {{time}}"
      }
    },
    "academic": {
      "grade_posted": {
        "title": "Nilai Baru Tersedia",
        "message": "Nilai {{subject}} untuk {{childName}} telah diperbarui"
      },
      "assignment_due": {
        "title": "Pengingat Tugas",
        "message": "Tugas {{assignment}} untuk {{childName}} akan jatuh tempo besok"
      }
    },
    "financial": {
      "payment_due": {
        "title": "Tagihan Jatuh Tempo",
        "message": "Pembayaran {{amount}} untuk {{childName}} akan jatuh tempo pada {{dueDate}}"
      }
    }
  },
  "portal": {
    "dashboard": {
      "welcome": "Selamat datang di Portal Orang Tua",
      "select_child": "Pilih Anak",
      "academic_overview": "Ringkasan Akademik",
      "recent_activities": "Aktivitas Terbaru"
    },
    "academic": {
      "history": "Riwayat Akademik",
      "current_grades": "Nilai Saat Ini",
      "attendance": "Kehadiran",
      "assignments": "Tugas"
    }
  }
}

// locales/en.json
{
  "notifications": {
    "daily_activity": {
      "arrival": {
        "title": "{{childName}} Has Arrived at School",
        "message": "{{childName}} arrived safely at {{time}}"
      },
      "meal": {
        "title": "Meal Time - {{childName}}",
        "message": "{{childName}} is having {{mealType}}. {{notes}}"
      }
    }
  }
}
```

### Week 29-32: Academic History Enhancement

#### Advanced Academic Analytics

```typescript
// analytics/academic-analytics.service.ts
@Injectable()
export class AcademicAnalyticsService {
  constructor(private prisma: PrismaService, private mlService: MachineLearningService) {}

  async getStudentProgressionAnalysis(studentId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      include: {
        grade: true,
        academicYear: true,
        studentGrades: {
          include: {
            subject: true,
          },
        },
      },
      orderBy: { enrollmentDate: "asc" },
    });

    const analysis = {
      totalYears: enrollments.length,
      averageGPA: this.calculateAverageGPA(enrollments),
      gradeProgression: this.analyzeGradeProgression(enrollments),
      subjectPerformance: this.analyzeSubjectPerformance(enrollments),
      attendancePattern: await this.getAttendancePattern(studentId),
      predictedOutcome: await this.predictAcademicOutcome(studentId),
      recommendations: this.generateRecommendations(enrollments),
    };

    return analysis;
  }

  async identifyAtRiskStudents(schoolId: string, gradeId?: string) {
    const students = await this.prisma.student.findMany({
      where: {
        schoolId,
        enrollments: gradeId
          ? {
              some: {
                gradeId,
                status: "ACTIVE",
              },
            }
          : undefined,
      },
      include: {
        enrollments: {
          include: {
            studentGrades: true,
          },
        },
        attendances: {
          where: {
            date: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
        },
      },
    });

    const atRiskStudents = [];

    for (const student of students) {
      const riskScore = await this.calculateRiskScore(student);
      if (riskScore > 0.7) {
        // Risk threshold
        atRiskStudents.push({
          student,
          riskScore,
          riskFactors: this.identifyRiskFactors(student),
          recommendations: this.generateInterventionRecommendations(student),
        });
      }
    }

    return atRiskStudents.sort((a, b) => b.riskScore - a.riskScore);
  }

  async generateProgressionPrediction(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: {
        enrollments: {
          include: {
            grade: true,
            studentGrades: {
              include: {
                subject: true,
              },
            },
          },
        },
        attendances: true,
      },
    });

    // Use ML model to predict academic outcomes
    const features = this.extractFeatures(student);
    const prediction = await this.mlService.predict("academic_progression", features);

    return {
      graduationProbability: prediction.graduationProbability,
      expectedGPA: prediction.expectedGPA,
      recommendedInterventions: prediction.interventions,
      careerReadiness: prediction.careerReadiness,
      collegeReadiness: prediction.collegeReadiness,
    };
  }

  private calculateAverageGPA(enrollments: any[]): number {
    const gpaValues = enrollments.filter((e) => e.finalGPA).map((e) => e.finalGPA);

    if (gpaValues.length === 0) return 0;

    return gpaValues.reduce((sum, gpa) => sum + gpa, 0) / gpaValues.length;
  }

  private analyzeGradeProgression(enrollments: any[]) {
    const progressions = [];

    for (let i = 1; i < enrollments.length; i++) {
      const previous = enrollments[i - 1];
      const current = enrollments[i];

      progressions.push({
        from: previous.grade.name,
        to: current.grade.name,
        type: current.promotionType,
        gpaChange: current.finalGPA - (previous.finalGPA || 0),
        year: current.academicYear.name,
      });
    }

    return progressions;
  }

  private async calculateRiskScore(student: any): Promise<number> {
    let riskScore = 0;

    // Academic performance factors
    const latestEnrollment = student.enrollments[student.enrollments.length - 1];
    if (latestEnrollment?.finalGPA < 2.0) riskScore += 0.3;
    if (latestEnrollment?.promotionType === "RETAINED") riskScore += 0.4;

    // Attendance factors
    const totalAttendance = student.attendances.length;
    const attendanceRate = totalAttendance / 30; // Assuming 30 school days
    if (attendanceRate < 0.8) riskScore += 0.2;
    if (attendanceRate < 0.6) riskScore += 0.3;

    // Behavioral factors (if available)
    // Add more sophisticated risk calculation

    return Math.min(riskScore, 1.0);
  }

  private identifyRiskFactors(student: any): string[] {
    const factors = [];

    const latestEnrollment = student.enrollments[student.enrollments.length - 1];
    if (latestEnrollment?.finalGPA < 2.0) factors.push("Low GPA");
    if (latestEnrollment?.promotionType === "RETAINED") factors.push("Grade Retention");

    const attendanceRate = student.attendances.length / 30;
    if (attendanceRate < 0.8) factors.push("Poor Attendance");

    return factors;
  }
}

// Machine Learning Service for Predictions
@Injectable()
export class MachineLearningService {
  private models: Map<string, any> = new Map();

  async predict(modelName: string, features: any): Promise<any> {
    // This would integrate with actual ML models
    // For now, returning mock predictions

    switch (modelName) {
      case "academic_progression":
        return this.predictAcademicProgression(features);
      case "dropout_risk":
        return this.predictDropoutRisk(features);
      default:
        throw new Error(`Model ${modelName} not found`);
    }
  }

  private predictAcademicProgression(features: any) {
    // Mock prediction logic - would be replaced with actual ML model
    const baseGPA = features.currentGPA || 3.0;
    const attendanceRate = features.attendanceRate || 0.9;
    const previousPerformance = features.previousPerformanceTrend || 0;

    const graduationProbability = Math.min(
      0.95,
      0.3 + (baseGPA / 4.0) * 0.4 + attendanceRate * 0.2 + previousPerformance * 0.1
    );

    const expectedGPA = Math.max(1.0, Math.min(4.0, baseGPA + previousPerformance * 0.5));

    return {
      graduationProbability,
      expectedGPA,
      interventions: this.generateInterventions(baseGPA, attendanceRate),
      careerReadiness: graduationProbability * 0.8,
      collegeReadiness: Math.max(0, (expectedGPA - 2.5) / 1.5),
    };
  }

  private generateInterventions(gpa: number, attendanceRate: number): string[] {
    const interventions = [];

    if (gpa < 2.5) interventions.push("Academic tutoring recommended");
    if (gpa < 2.0) interventions.push("Intensive academic support needed");
    if (attendanceRate < 0.8) interventions.push("Attendance intervention required");
    if (attendanceRate < 0.6) interventions.push("Family engagement needed");

    return interventions;
  }
}
```

### Week 33-36: Financial Management Enhancement

#### Advanced Payment System with White-Label Integration

```typescript
// payments/payment.service.ts
@Injectable()
export class PaymentService {
  constructor(
    private prisma: PrismaService,
    private midtransService: MidtransService,
    private xenditService: XenditService,
    private notificationService: NotificationService,
    private whiteLabelService: WhiteLabelService
  ) {}

  async createInvoice(createInvoiceDto: CreateInvoiceDto) {
    const invoice = await this.prisma.invoice.create({
      data: {
        ...createInvoiceDto,
        invoiceNumber: await this.generateInvoiceNumber(createInvoiceDto.schoolId),
        status: InvoiceStatus.PENDING,
        createdAt: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      },
      include: {
        student: {
          include: {
            parents: {
              include: {
                parent: true,
              },
            },
          },
        },
        school: {
          include: {
            tenant: {
              include: {
                whiteLabelConfig: true,
              },
            },
          },
        },
        items: true,
      },
    });

    // Send invoice notification to parents
    await this.notificationService.sendInvoiceNotification(invoice);

    return invoice;
  }

  async createPaymentLink(invoiceId: string, paymentMethod: PaymentMethod) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        student: {
          include: {
            parents: {
              include: {
                parent: true,
              },
            },
          },
        },
        school: {
          include: {
            tenant: {
              include: {
                whiteLabelConfig: true,
              },
            },
          },
        },
        items: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }

    // Get white-label configuration for branded payment page
    const whiteLabelConfig = invoice.school.tenant.whiteLabelConfig;

    const paymentData = {
      invoice,
      branding: {
        schoolName: invoice.school.name,
        logo: whiteLabelConfig?.logoUrl,
        primaryColor: whiteLabelConfig?.primaryColor || "#1e40af",
        customDomain: invoice.school.tenant.customDomain,
      },
    };

    let paymentLink: string;

    switch (paymentMethod) {
      case PaymentMethod.MIDTRANS:
        paymentLink = await this.midtransService.createPaymentLink(paymentData);
        break;
      case PaymentMethod.XENDIT:
        paymentLink = await this.xenditService.createPaymentLink(paymentData);
        break;
      default:
        throw new BadRequestException("Unsupported payment method");
    }

    // Save payment link
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { paymentLink },
    });

    return { paymentLink, invoice };
  }

  async processInstallmentPlan(studentId: string, installmentPlanDto: CreateInstallmentPlanDto) {
    const plan = await this.prisma.installmentPlan.create({
      data: {
        studentId,
        ...installmentPlanDto,
        status: InstallmentStatus.ACTIVE,
      },
    });

    // Create individual installment invoices
    const installments = [];
    const installmentAmount =
      installmentPlanDto.totalAmount / installmentPlanDto.numberOfInstallments;

    for (let i = 0; i < installmentPlanDto.numberOfInstallments; i++) {
      const dueDate = new Date(installmentPlanDto.startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      const installment = await this.prisma.installment.create({
        data: {
          installmentPlanId: plan.id,
          amount: installmentAmount,
          dueDate,
          installmentNumber: i + 1,
          status: InstallmentStatus.PENDING,
        },
      });

      // Create invoice for this installment
      const invoice = await this.createInvoice({
        studentId,
        schoolId: installmentPlanDto.schoolId,
        title: `Installment ${i + 1} - ${installmentPlanDto.description}`,
        description: `Payment ${i + 1} of ${installmentPlanDto.numberOfInstallments}`,
        amount: installmentAmount,
        dueDate,
        type: InvoiceType.INSTALLMENT,
        installmentId: installment.id,
      });

      installments.push({ installment, invoice });
    }

    return { plan, installments };
  }

  async handlePaymentWebhook(provider: string, payload: any) {
    switch (provider) {
      case "midtrans":
        return this.handleMidtransWebhook(payload);
      case "xendit":
        return this.handleXenditWebhook(payload);
      default:
        throw new BadRequestException("Unknown payment provider");
    }
  }

  private async handleMidtransWebhook(payload: any) {
    const { order_id, transaction_status, gross_amount } = payload;

    const invoice = await this.prisma.invoice.findFirst({
      where: { invoiceNumber: order_id },
      include: {
        student: {
          include: {
            parents: {
              include: {
                parent: true,
              },
            },
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }

    let status: InvoiceStatus;
    switch (transaction_status) {
      case "capture":
      case "settlement":
        status = InvoiceStatus.PAID;
        break;
      case "pending":
        status = InvoiceStatus.PENDING;
        break;
      case "deny":
      case "cancel":
      case "expire":
        status = InvoiceStatus.CANCELLED;
        break;
      default:
        status = InvoiceStatus.PENDING;
    }

    // Update invoice status
    const updatedInvoice = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        status,
        paidAt: status === InvoiceStatus.PAID ? new Date() : null,
        paidAmount: status === InvoiceStatus.PAID ? parseFloat(gross_amount) : null,
      },
    });

    // Create payment record
    if (status === InvoiceStatus.PAID) {
      await this.prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: parseFloat(gross_amount),
          paymentMethod: PaymentMethod.MIDTRANS,
          transactionId: payload.transaction_id,
          paymentDate: new Date(),
          status: PaymentStatus.SUCCESS,
        },
      });

      // Update installment if applicable
      if (invoice.installmentId) {
        await this.prisma.installment.update({
          where: { id: invoice.installmentId },
          data: {
            status: InstallmentStatus.PAID,
            paidAt: new Date(),
          },
        });
      }

      // Send payment confirmation notification
      await this.notificationService.sendPaymentConfirmation(updatedInvoice);
    }

    return updatedInvoice;
  }

  async getStudentFinancialSummary(studentId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { studentId },
      include: {
        items: true,
        payments: true,
        installment: {
          include: {
            installmentPlan: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const paidAmount = invoices
      .filter((inv) => inv.status === InvoiceStatus.PAID)
      .reduce((sum, inv) => sum + inv.amount, 0);
    const pendingAmount = invoices
      .filter((inv) => inv.status === InvoiceStatus.PENDING)
      .reduce((sum, inv) => sum + inv.amount, 0);
    const overdueAmount = invoices
      .filter((inv) => inv.status === InvoiceStatus.PENDING && new Date(inv.dueDate) < new Date())
      .reduce((sum, inv) => sum + inv.amount, 0);

    const installmentPlans = await this.prisma.installmentPlan.findMany({
      where: { studentId },
      include: {
        installments: true,
      },
    });

    return {
      totalAmount,
      paidAmount,
      pendingAmount,
      overdueAmount,
      paymentRate: totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0,
      invoices,
      installmentPlans,
      nextDueDate: this.getNextDueDate(invoices),
    };
  }

  private async generateInvoiceNumber(schoolId: string): Promise<string> {
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId },
    });

    const count = await this.prisma.invoice.count({
      where: { schoolId },
    });

    const year = new Date().getFullYear();
    const month = (new Date().getMonth() + 1).toString().padStart(2, "0");

    return `INV-${school.nisp || "SCH"}-${year}${month}-${(count + 1).toString().padStart(4, "0")}`;
  }

  private getNextDueDate(invoices: any[]): Date | null {
    const pendingInvoices = invoices.filter((inv) => inv.status === InvoiceStatus.PENDING);
    if (pendingInvoices.length === 0) return null;

    return pendingInvoices.reduce((earliest, inv) => {
      return new Date(inv.dueDate) < new Date(earliest) ? inv.dueDate : earliest;
    }, pendingInvoices[0].dueDate);
  }
}

// Midtrans Integration Service
@Injectable()
export class MidtransService {
  constructor(private configService: ConfigService) {}

  async createPaymentLink(paymentData: any): Promise<string> {
    const { invoice, branding } = paymentData;

    const parameter = {
      transaction_details: {
        order_id: invoice.invoiceNumber,
        gross_amount: invoice.amount,
      },
      customer_details: {
        first_name: invoice.student.firstName,
        last_name: invoice.student.lastName,
        email: invoice.student.parents[0]?.parent.email,
        phone: invoice.student.parents[0]?.parent.phone,
      },
      item_details: invoice.items.map((item) => ({
        id: item.id,
        price: item.amount,
        quantity: item.quantity,
        name: item.description,
      })),
      custom_expiry: {
        expiry_duration: 24,
        unit: "hour",
      },
      // White-label customization
      custom_field1: branding.schoolName,
      custom_field2: branding.logo,
      custom_field3: branding.primaryColor,
    };

    try {
      const response = await fetch(`${this.configService.get("MIDTRANS_URL")}/v1/payment-links`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(
            this.configService.get("MIDTRANS_SERVER_KEY") + ":"
          ).toString("base64")}`,
        },
        body: JSON.stringify(parameter),
      });

      const result = await response.json();
      return result.payment_url;
    } catch (error) {
      throw new Error(`Failed to create Midtrans payment link: ${error.message}`);
    }
  }
}

// DTOs
export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @IsEnum(InvoiceType)
  @IsOptional()
  type?: InvoiceType = InvoiceType.REGULAR;

  @IsString()
  @IsOptional()
  installmentId?: string;

  @IsArray()
  @IsOptional()
  items?: CreateInvoiceItemDto[];
}

export class CreateInstallmentPlanDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsNumber()
  @IsPositive()
  @Min(2)
  @Max(12)
  numberOfInstallments: number;

  @IsDateString()
  startDate: string;

  @IsEnum(InstallmentFrequency)
  @IsOptional()
  frequency?: InstallmentFrequency = InstallmentFrequency.MONTHLY;
}

enum InvoiceStatus {
  PENDING = "pending",
  PAID = "paid",
  CANCELLED = "cancelled",
  OVERDUE = "overdue",
}

enum InvoiceType {
  REGULAR = "regular",
  INSTALLMENT = "installment",
  LATE_FEE = "late_fee",
}

enum PaymentMethod {
  MIDTRANS = "midtrans",
  XENDIT = "xendit",
  BANK_TRANSFER = "bank_transfer",
  CASH = "cash",
}

enum InstallmentStatus {
  PENDING = "pending",
  PAID = "paid",
  OVERDUE = "overdue",
  CANCELLED = "cancelled",
  ACTIVE = "active",
}

enum InstallmentFrequency {
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  SEMESTER = "semester",
}
```

### Week 37-40: Mobile Application Development

#### React Native Mobile App Structure

```typescript
// mobile/src/types/index.ts
export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  school: {
    name: string;
    schoolType: SchoolType;
  };
  currentEnrollment: {
    grade: { name: string };
    class: { name: string };
  };
}

export interface DailyActivity {
  id: string;
  type: ActivityType;
  description: string;
  notes?: string;
  mood?: MoodType;
  createdAt: string;
  photos: ActivityPhoto[];
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  isRead: boolean;
  createdAt: string;
  data?: any;
}

// mobile/src/services/api.ts
class ApiService {
  private baseURL: string;
  private token: string | null = null;

  constructor() {
    this.baseURL = Config.API_URL;
  }

  setToken(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }

  // Authentication
  async login(email: string, password: string) {
    return this.request<{ access_token: string; user: any }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  // Parent endpoints
  async getChildren(): Promise<Student[]> {
    return this.request<Student[]>("/parents/children");
  }

  async getChildDailyActivities(studentId: string, date: string): Promise<DailyActivity[]> {
    return this.request<DailyActivity[]>(`/students/${studentId}/daily-activities?date=${date}`);
  }

  async getChildAcademicHistory(studentId: string) {
    return this.request(`/students/${studentId}/academic-history`);
  }

  async getNotifications(): Promise<Notification[]> {
    return this.request<Notification[]>("/notifications");
  }

  async markNotificationAsRead(notificationId: string) {
    return this.request(`/notifications/${notificationId}/read`, {
      method: "PATCH",
    });
  }

  async getFinancialSummary(studentId: string) {
    return this.request(`/students/${studentId}/financial-summary`);
  }
}

export const apiService = new ApiService();

// mobile/src/screens/ParentDashboard.tsx
import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Picker } from "@react-native-picker/picker";
import { useTheme } from "../contexts/ThemeContext";
import { useLanguage } from "../contexts/LanguageContext";
import { apiService } from "../services/api";

const ParentDashboard: React.FC = () => {
  const [children, setChildren] = useState<Student[]>([]);
  const [selectedChild, setSelectedChild] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { theme } = useTheme();
  const { t } = useLanguage();

  useEffect(() => {
    loadChildren();
  }, []);

  const loadChildren = async () => {
    try {
      const childrenData = await apiService.getChildren();
      setChildren(childrenData);
      if (childrenData.length > 0 && !selectedChild) {
        setSelectedChild(childrenData[0].id);
      }
    } catch (error) {
      console.error("Failed to load children:", error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChildren();
    setRefreshing(false);
  };

  const currentChild = children.find((child) => child.id === selectedChild);

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <Text>{t("common.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.text }]}>{t("dashboard.welcome")}</Text>
        </View>

        {/* Child Selector */}
        {children.length > 1 && (
          <View style={[styles.pickerContainer, { backgroundColor: theme.card }]}>
            <Text style={[styles.pickerLabel, { color: theme.text }]}>
              {t("dashboard.selectChild")}
            </Text>
            <Picker
              selectedValue={selectedChild}
              onValueChange={setSelectedChild}
              style={styles.picker}
            >
              {children.map((child) => (
                <Picker.Item
                  key={child.id}
                  label={`${child.firstName} ${child.lastName}`}
                  value={child.id}
                />
              ))}
            </Picker>
          </View>
        )}

        {/* Current Child Info */}
        {currentChild && (
          <>
            <ChildOverviewCard child={currentChild} />
            <QuickActionsGrid
              childId={currentChild.id}
              schoolType={currentChild.school.schoolType}
            />
            <RecentNotifications childId={currentChild.id} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

// mobile/src/components/DailyActivitiesView.tsx
const DailyActivitiesView: React.FC<{ studentId: string }> = ({ studentId }) => {
  const [activities, setActivities] = useState<DailyActivity[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const { theme } = useTheme();
  const { t } = useLanguage();

  useEffect(() => {
    loadDailyActivities();
  }, [studentId, selectedDate]);

  const loadDailyActivities = async () => {
    try {
      const dateStr = selectedDate.toISOString().split("T")[0];
      const activitiesData = await apiService.getChildDailyActivities(studentId, dateStr);
      setActivities(activitiesData);
    } catch (error) {
      console.error("Failed to load daily activities:", error);
    }
  };

  const renderActivityItem = (activity: DailyActivity) => (
    <View key={activity.id} style={[styles.activityItem, { backgroundColor: theme.card }]}>
      <View style={styles.activityHeader}>
        <Text style={[styles.activityType, { color: theme.text }]}>
          {t(`activities.${activity.type}`)}
        </Text>
        <Text style={[styles.activityTime, { color: theme.textSecondary }]}>
          {new Date(activity.createdAt).toLocaleTimeString()}
        </Text>
      </View>

      {activity.description && (
        <Text style={[styles.activityDescription, { color: theme.text }]}>
          {activity.description}
        </Text>
      )}

      {activity.mood && (
        <View style={styles.moodContainer}>
          <Text style={[styles.moodText, { color: theme.textSecondary }]}>
            {t("activities.mood")}: {t(`moods.${activity.mood}`)}
          </Text>
        </View>
      )}

      {activity.photos.length > 0 && (
        <ScrollView horizontal style={styles.photosContainer}>
          {activity.photos.map((photo) => (
            <TouchableOpacity key={photo.id} onPress={() => openPhotoViewer(photo.photoUrl)}>
              <Image source={{ uri: photo.photoUrl }} style={styles.activityPhoto} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {activity.notes && (
        <Text style={[styles.activityNotes, { color: theme.textSecondary }]}>
          {t("activities.teacherNotes")}: {activity.notes}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <DatePicker date={selectedDate} onDateChange={setSelectedDate} maximumDate={new Date()} />

      <ScrollView style={styles.activitiesList}>
        {activities.length > 0 ? (
          activities.map(renderActivityItem)
        ) : (
          <View style={styles.noActivitiesContainer}>
            <Text style={[styles.noActivitiesText, { color: theme.textSecondary }]}>
              {t("activities.noActivitiesFound")}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  pickerContainer: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
  },
  pickerLabel: {
    fontSize: 16,
    marginBottom: 8,
  },
  picker: {
    height: 50,
  },
  activityItem: {
    margin: 16,
    padding: 16,
    borderRadius: 8,
    elevation: 2,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  activityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  activityType: {
    fontSize: 16,
    fontWeight: "600",
  },
  activityTime: {
    fontSize: 14,
  },
  activityDescription: {
    fontSize: 14,
    marginBottom: 8,
  },
  moodContainer: {
    marginBottom: 8,
  },
  moodText: {
    fontSize: 14,
    fontStyle: "italic",
  },
  photosContainer: {
    marginVertical: 8,
  },
  activityPhoto: {
    width: 80,
    height: 80,
    borderRadius: 8,
    marginRight: 8,
  },
  activityNotes: {
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
  },
  activitiesList: {
    flex: 1,
  },
  noActivitiesContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  noActivitiesText: {
    fontSize: 16,
    textAlign: "center",
  },
});

export default DailyActivitiesView;
```

## Phase 4: Production Readiness (Bulan 11-12, 8 Minggu)

### Week 41-44: Security & Performance Optimization

#### Security Hardening

```typescript
// security/security.module.ts
@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 100,
    }),
    HelmetModule.register({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }),
  ],
  providers: [SecurityService, AuditLogService, EncryptionService],
  exports: [SecurityService],
})
export class SecurityModule {}

// security/audit-log.service.ts
@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async logActivity(activity: CreateAuditLogDto) {
    return this.prisma.auditLog.create({
      data: {
        ...activity,
        timestamp: new Date(),
        ipAddress: this.getClientIP(activity.request),
        userAgent: activity.request?.get("user-agent"),
      },
    });
  }

  async logDataAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    action: string,
    request?: any
  ) {
    return this.logActivity({
      userId,
      action,
      resourceType,
      resourceId,
      request,
    });
  }

  async getSecurityReports(tenantId: string, filters: SecurityReportFilters) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        user: {
          tenantId,
        },
        timestamp: {
          gte: filters.startDate,
          lte: filters.endDate,
        },
        ...(filters.userId && { userId: filters.userId }),
        ...(filters.action && { action: filters.action }),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
    });

    return {
      logs,
      summary: {
        totalActivities: logs.length,
        uniqueUsers: new Set(logs.map((l) => l.userId)).size,
        topActions: this.getTopActions(logs),
        riskActivities: logs.filter((l) => this.isRiskActivity(l)),
      },
    };
  }

  private getClientIP(request: any): string {
    return (
      request?.ip ||
      request?.connection?.remoteAddress ||
      request?.socket?.remoteAddress ||
      (request?.connection?.socket ? request.connection.socket.remoteAddress : null) ||
      "unknown"
    );
  }

  private getTopActions(logs: any[]): Array<{ action: string; count: number }> {
    const actionCounts = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private isRiskActivity(log: any): boolean {
    const riskActions = [
      "FAILED_LOGIN_ATTEMPT",
      "UNAUTHORIZED_ACCESS",
      "DATA_EXPORT",
      "BULK_DELETE",
      "ADMIN_PRIVILEGE_CHANGE",
    ];
    return riskActions.includes(log.action);
  }
}

// security/encryption.service.ts
@Injectable()
export class EncryptionService {
  private readonly algorithm = "aes-256-gcm";
  private readonly keyLength = 32;
  private readonly ivLength = 16;
  private readonly tagLength = 16;

  constructor(private configService: ConfigService) {}

  encrypt(text: string, key?: string): string {
    const encryptionKey = key
      ? Buffer.from(key, "hex")
      : Buffer.from(this.configService.get("ENCRYPTION_KEY"), "hex");
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipher(this.algorithm, encryptionKey);
    cipher.setAAD(Buffer.from("additional_data", "utf8"));

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
  }

  decrypt(encryptedText: string, key?: string): string {
    const encryptionKey = key
      ? Buffer.from(key, "hex")
      : Buffer.from(this.configService.get("ENCRYPTION_KEY"), "hex");
    const [ivHex, tagHex, encrypted] = encryptedText.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = crypto.createDecipher(this.algorithm, encryptionKey);

    decipher.setAAD(Buffer.from("additional_data", "utf8"));
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString("hex");
  }
}

// Performance optimization with Redis caching
// cache/cache.service.ts
@Injectable()
export class CacheService {
  constructor(
    @Inject("REDIS_CLIENT") private redisClient: Redis,
    private configService: ConfigService
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error("Cache get error:", error);
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.redisClient.setex(key, ttlSeconds, serialized);
      } else {
        await this.redisClient.set(key, serialized);
      }
    } catch (error) {
      console.error("Cache set error:", error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redisClient.del(key);
    } catch (error) {
      console.error("Cache delete error:", error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redisClient.keys(pattern);
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
      }
    } catch (error) {
      console.error("Cache pattern invalidation error:", error);
    }
  }

  // Specific caching methods for the application
  async cacheStudentData(studentId: string, data: any, ttlMinutes: number = 30): Promise<void> {
    await this.set(`student:${studentId}`, data, ttlMinutes * 60);
  }

  async getCachedStudentData(studentId: string): Promise<any> {
    return this.get(`student:${studentId}`);
  }

  async cacheAcademicHistory(
    studentId: string,
    history: any,
    ttlMinutes: number = 60
  ): Promise<void> {
    await this.set(`academic_history:${studentId}`, history, ttlMinutes * 60);
  }

  async getCachedAcademicHistory(studentId: string): Promise<any> {
    return this.get(`academic_history:${studentId}`);
  }

  async cacheParentChildren(
    parentId: string,
    children: any,
    ttlMinutes: number = 15
  ): Promise<void> {
    await this.set(`parent_children:${parentId}`, children, ttlMinutes * 60);
  }

  async getCachedParentChildren(parentId: string): Promise<any> {
    return this.get(`parent_children:${parentId}`);
  }

  async invalidateStudentCache(studentId: string): Promise<void> {
    await this.invalidatePattern(`*${studentId}*`);
  }
}

// Database query optimization
// common/interceptors/cache.interceptor.ts
@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(private cacheService: CacheService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user } = request;

    // Only cache GET requests
    if (method !== "GET") {
      return next.handle();
    }

    // Generate cache key
    const cacheKey = this.generateCacheKey(url, user?.id);

    return from(this.cacheService.get(cacheKey)).pipe(
      switchMap((cached) => {
        if (cached) {
          return of(cached);
        }

        return next.handle().pipe(
          tap((response) => {
            // Cache successful responses
            if (response && !response.error) {
              this.cacheService.set(cacheKey, response, this.getTTL(url));
            }
          })
        );
      })
    );
  }

  private generateCacheKey(url: string, userId?: string): string {
    const baseKey = `api:${url.replace(/[^a-zA-Z0-9]/g, "_")}`;
    return userId ? `${baseKey}:user:${userId}` : baseKey;
  }

  private getTTL(url: string): number {
    // Different TTL for different endpoints
    if (url.includes("academic-history")) return 3600; // 1 hour
    if (url.includes("students")) return 1800; // 30 minutes
    if (url.includes("daily-activities")) return 300; // 5 minutes
    return 900; // 15 minutes default
  }
}
```

### Week 45-46: Load Testing & Optimization

#### Performance Testing Setup

```typescript
// tests/load/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');

export let options = {
  stages: [
    { duration: '2m', target: 10 }, // Ramp up
    { duration: '5m', target: 50 }, // Stay at 50 users
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests under 2s
    http_req_failed: ['rate<0.05'], // Error rate under 5%
    errors: ['rate<0.1'],
  },
};

const BASE_URL = 'https://your-api-domain.com';

export function setup() {
  // Login and get auth token
  const loginRes = http.post(`${BASE_URL}/auth/login`, {
    email: 'test.parent@school.com',
    password: 'testpassword123',
  });

  return { token: loginRes.json('access_token') };
}

export default function(data) {
  const headers = {
    'Authorization': `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // Test scenarios
  testParentDashboard(headers);
  testStudentData(headers);
  testAcademicHistory(headers);
  testDailyActivities(headers);
  testNotifications(headers);

  sleep(1);
}

function testParentDashboard(headers) {
  const res = http.get(`${BASE_URL}/parents/children`, { headers });
  const success = check(res, {
    'parent dashboard status is 200': (r) => r.status === 200,
    'parent dashboard response time < 1s': (r) => r.timings.duration < 1000,
    'children data is returned': (r) => r.json().length > 0,
  });

  if (!success) {
    errorRate.add(1);
  }
}

function testStudentData(headers) {
  const childrenRes = http.get(`${BASE_URL}/parents/children`, { headers });
  if (childrenRes.status === 200) {
    const children = childrenRes.json();
    if (children.length > 0) {
      const studentId = children[0].student.id;

      const res = http.get(`${BASE_URL}/students/${studentId}`, { headers });
      check(res, {
        'student data status is 200': (r) => r.status === 200,
        'student data response time < 500ms': (r) => r.timings.duration < 500,
      });
    }
  }
}

function testAcademicHistory(headers) {
  const childrenRes = http.get(`${BASE_URL}/parents/children`, { headers });
  if (childrenRes.status === 200) {
    const children = childrenRes.json();
    if (children.length > 0) {
      const studentId = children[0].student.id;

      const res = http.get(`${BASE_URL}/students/${studentId}/academic-history`, { headers });
      check(res, {
        'academic history status is 200': (r) => r.status === 200,
        'academic history response time < 1.5s': (r) => r.timings.duration < 1500,
      });
    }
  }
}

function testDailyActivities(headers) {
  const today = new Date().toISOString().split('T')[0];
  const childrenRes = http.get(`${BASE_URL}/parents/children`, { headers });

  if (childrenRes.status === 200) {
    const children = childrenRes.json();
    if (children.length > 0) {
      const studentId = children[0].student.id;

      const res = http.get(`${BASE_URL}/students/${studentId}/daily-activities?date=${today}`, { headers });
      check(res, {
        'daily activities status is 200': (r) => r.status === 200,
        'daily activities response time < 800ms': (r) => r.timings.duration < 800,
      });
    }
  }
}

function testNotifications(headers) {
  const res = http.get(`${BASE_URL}/notifications`, { headers });
  check(res, {
    'notifications status is 200': (r) => r.status === 200,
    'notifications response time < 600ms': (r) => r.timings.duration < 600,
  });
}

// Database optimization queries
// database/optimizations.sql
-- Indexes for performance optimization

-- Student queries
CREATE INDEX CONCURRENTLY idx_students_school_active ON students(school_id, is_active) WHERE is_active = true;
CREATE INDEX CONCURRENTLY idx_students_nisn ON students(nisn) WHERE nisn IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_students_name ON students(first_name, last_name);

-- Enrollment queries (Academic History)
CREATE INDEX CONCURRENTLY idx_enrollments_student_date ON enrollments(student_id, enrollment_date DESC);
CREATE INDEX CONCURRENTLY idx_enrollments_academic_year ON enrollments(academic_year_id, status);
CREATE INDEX CONCURRENTLY idx_enrollments_class_active ON enrollments(class_id, status) WHERE status = 'ACTIVE';

-- Parent-Student relationships
CREATE INDEX CONCURRENTLY idx_student_parents_parent ON student_parents(parent_id);
CREATE INDEX CONCURRENTLY idx_student_parents_student ON student_parents(student_id);

-- Daily Activities (for KB/TK)
CREATE INDEX CONCURRENTLY idx_daily_activities_student_date ON daily_activities(student_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_daily_activities_date_type ON daily_activities(created_at::date, type);

-- Notifications
CREATE INDEX CONCURRENTLY idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC) WHERE is_read = false;
CREATE INDEX CONCURRENTLY idx_notifications_student ON notifications(student_id, created_at DESC);

-- Payments and Invoices
CREATE INDEX CONCURRENTLY idx_invoices_student_status ON invoices(student_id, status, due_date);
CREATE INDEX CONCURRENTLY idx_invoices_school_date ON invoices(school_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_payments_invoice ON payments(invoice_id);

-- Audit logs
CREATE INDEX CONCURRENTLY idx_audit_logs_user_date ON audit_logs(user_id, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_logs_tenant_date ON audit_logs(tenant_id, timestamp DESC);

-- White-label configurations
CREATE INDEX CONCURRENTLY idx_white_label_tenant ON white_label_configs(tenant_id);

-- Attendances
CREATE INDEX CONCURRENTLY idx_attendances_student_date ON attendances(student_id, date DESC);
CREATE INDEX CONCURRENTLY idx_attendances_class_date ON attendances(class_id, date DESC);

-- Grades
CREATE INDEX CONCURRENTLY idx_student_grades_student ON student_grades(student_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_student_grades_subject ON student_grades(subject_id, created_at DESC);

-- Performance monitoring views
CREATE OR REPLACE VIEW performance_metrics AS
SELECT
  schemaname,
  tablename,
  attname,
  n_distinct,
  correlation,
  most_common_vals,
  most_common_freqs
FROM pg_stats
WHERE schemaname = 'public'
  AND tablename IN ('students', 'enrollments', 'notifications', 'daily_activities', 'invoices')
ORDER BY tablename, attname;

-- Query performance analysis
CREATE OR REPLACE FUNCTION analyze_slow_queries()
RETURNS TABLE(
  query text,
  calls bigint,
  total_time double precision,
  mean_time double precision,
  rows bigint
) AS $
BEGIN
  RETURN QUERY
  SELECT
    pg_stat_statements.query,
    pg_stat_statements.calls,
    pg_stat_statements.total_exec_time,
    pg_stat_statements.mean_exec_time,
    pg_stat_statements.rows
  FROM pg_stat_statements
  WHERE pg_stat_statements.mean_exec_time > 100 -- queries taking more than 100ms
    AND pg_stat_statements.calls > 10 -- called more than 10 times
  ORDER BY pg_stat_statements.mean_exec_time DESC
  LIMIT 20;
END;
$ LANGUAGE plpgsql;
```

### Week 47-48: Final Deployment & Training

#### Production Deployment Configuration

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    image: education-platform:latest
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - JWT_SECRET=${JWT_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    volumes:
      - ./uploads:/app/uploads
      - ./logs:/app/logs
    networks:
      - app-network

  postgres:
    image: postgres:15
    restart: unless-stopped
    environment:
      - POSTGRES_DB=${DB_NAME}
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/init:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    networks:
      - app-network

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    networks:
      - app-network

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - ./uploads:/var/www/uploads
    depends_on:
      - app
    networks:
      - app-network

volumes:
  postgres_data:
  redis_data:

networks:
  app-network:
    driver: bridge

# Dockerfile.prod
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:18-alpine AS runner

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

USER nextjs

EXPOSE 3000

CMD ["node", "dist/main"]

# nginx/nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream api {
        server app:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;

    server {
        listen 80;
        server_name _;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name _;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";

        # API endpoints
        location /api/ {
            limit_req zone=api burst=20 nodelay;

            proxy_pass http://api;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Login endpoint with stricter rate limiting
        location /api/auth/login {
            limit_req zone=login burst=5 nodelay;

            proxy_pass http://api;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Static files
        location /uploads/ {
            alias /var/www/uploads/;
            expires 30d;
            add_header Cache-Control "public, immutable";
        }

        # Health check
        location /health {
            proxy_pass http://api/health;
        }
    }
}

# GitHub Actions CI/CD
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db

      - name: Run e2e tests
        run: npm run test:e2e
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db

  build-and-deploy:
    needs: test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Build Docker image
        run: |
          docker build -f Dockerfile.prod -t education-platform:${{ github.sha }} .
          docker tag education-platform:${{ github.sha }} education-platform:latest

      - name: Deploy to production
        run: |
          # Deploy using your preferred method (Docker Swarm, Kubernetes, etc.)
          echo "Deploying to production..."
          # docker stack deploy -c docker-compose.prod.yml education-platform
```

#### Training Materials & Documentation

```markdown
# deployment/DEPLOYMENT_GUIDE.md

# Educational Management System - Deployment Guide

## Prerequisites

### Server Requirements

- **CPU**: Minimum 4 cores (8 cores recommended for production)
- **RAM**: Minimum 8GB (16GB recommended)
- **Storage**: Minimum 100GB SSD (500GB recommended)
- **OS**: Ubuntu 20.04 LTS or higher
- **Network**: Static IP address with domain name

### Domain Setup

1. Purchase domain (e.g., `sekolah.sch.id`)
2. Configure DNS records:
```

A @ YOUR_SERVER_IP
A www YOUR_SERVER_IP
A \* YOUR_SERVER_IP (for white-label subdomains)

````

## Installation Steps

### 1. Server Setup
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create application directory
sudo mkdir -p /opt/education-platform
cd /opt/education-platform
````

### 2. Environment Configuration

```bash
# Create environment file
sudo nano .env
```

```env
# Database
DB_NAME=education_platform
DB_USER=education_user
DB_PASSWORD=your_secure_password_here
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}

# Redis
REDIS_URL=redis://redis:6379

# Application
NODE_ENV=production
PORT=3000
JWT_SECRET=your_jwt_secret_here_min_32_chars
ENCRYPTION_KEY=your_encryption_key_here_64_chars

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password

# WhatsApp Integration (optional)
WHATSAPP_API_URL=https://api.whatsapp.com
WHATSAPP_TOKEN=your_whatsapp_token

# Payment Gateways
MIDTRANS_SERVER_KEY=your_midtrans_server_key
MIDTRANS_CLIENT_KEY=your_midtrans_client_key
MIDTRANS_URL=https://api.sandbox.midtrans.com

# File Storage
AWS_REGION=ap-southeast-1
AWS_BUCKET=your-s3-bucket
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key

# Security
ADMIN_EMAIL=admin@yourschool.com
```

### 3. SSL Certificate Setup

```bash
# Install Certbot
sudo apt install certbot

# Generate certificates for main domain
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Generate wildcard certificate for subdomains
sudo certbot certonly --manual --preferred-challenges dns -d yourdomain.com -d *.yourdomain.com
```

### 4. Application Deployment

```bash
# Download docker-compose file
wget https://raw.githubusercontent.com/yourrepo/education-platform/main/docker-compose.prod.yml

# Start services
sudo docker-compose -f docker-compose.prod.yml up -d

# Verify services are running
sudo docker-compose -f docker-compose.prod.yml ps

# Check logs
sudo docker-compose -f docker-compose.prod.yml logs app
```

### 5. Database Migration

```bash
# Run migrations
sudo docker-compose -f docker-compose.prod.yml exec app npm run migrate

# Seed initial data
sudo docker-compose -f docker-compose.prod.yml exec app npm run seed

# Create first admin user
sudo docker-compose -f docker-compose.prod.yml exec app npm run create-admin
```

## Post-Deployment Configuration

### 1. Platform Owner Setup

1. Access admin panel at `https://yourdomain.com/admin`
2. Login with created admin credentials
3. Configure platform settings:
   - Default language preferences
   - Email templates
   - Payment gateway settings
   - White-label pricing plans

### 2. First Tenant Setup

1. Create first tenant account
2. Configure white-label settings
3. Setup first school
4. Create school admin account

### 3. Security Hardening

```bash
# Setup firewall
sudo ufw allow ssh
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# Setup fail2ban
sudo apt install fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Monitoring and Maintenance

### 1. Health Monitoring

```bash
# Check application health
curl https://yourdomain.com/health

# Monitor resource usage
sudo docker stats

# Check logs
sudo docker-compose logs -f app
```

### 2. Backup Strategy

```bash
# Create backup script
sudo nano /opt/backup.sh
```

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups"

# Create backup directory
mkdir -p $BACKUP_DIR

# Database backup
sudo docker-compose exec postgres pg_dump -U education_user education_platform > $BACKUP_DIR/db_backup_$DATE.sql

# File backup
tar -czf $BACKUP_DIR/files_backup_$DATE.tar.gz /opt/education-platform/uploads

# Clean old backups (keep last 30 days)
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

```bash
# Make executable and schedule
sudo chmod +x /opt/backup.sh
sudo crontab -e
# Add: 0 2 * * * /opt/backup.sh
```

### 3. Performance Monitoring

- Setup monitoring with Grafana + Prometheus
- Configure alerts for high CPU/memory usage
- Monitor database performance
- Track API response times

## Troubleshooting

### Common Issues

#### 1. Application Won't Start

```bash
# Check logs
sudo docker-compose logs app

# Common fixes:
# - Check environment variables
# - Verify database connection
# - Check file permissions
```

#### 2. Database Connection Issues

```bash
# Check PostgreSQL status
sudo docker-compose exec postgres pg_isready

# Reset database connection
sudo docker-compose restart postgres app
```

#### 3. SSL Certificate Issues

```bash
# Renew certificates
sudo certbot renew

# Update nginx configuration
sudo docker-compose restart nginx
```

## Scaling Considerations

### 1. Horizontal Scaling

- Use load balancer (HAProxy/Nginx)
- Setup multiple app instances
- Shared Redis for session storage
- External database cluster

### 2. Vertical Scaling

- Increase server resources
- Optimize database configuration
- Implement caching strategies
- CDN for static files

## Support and Maintenance

### Regular Maintenance Tasks

1. **Weekly Tasks**:

   - Monitor system performance
   - Check error logs
   - Verify backup integrity
   - Review security alerts

2. **Monthly Tasks**:

   - Update system packages
   - Renew SSL certificates if needed
   - Database performance optimization
   - Clean up old log files

3. **Quarterly Tasks**:
   - Full security audit
   - Performance benchmarking
   - Disaster recovery testing
   - Feature usage analytics review

### Emergency Procedures

- **Database corruption**: Restore from latest backup
- **Security breach**: Immediate password reset, audit logs review
- **Performance degradation**: Scale resources, check for bottlenecks
- **Data loss**: Restore from backup, verify data integrity

## Training Materials

### 1. Platform Owner Training

**Duration**: 2 days

**Day 1: System Administration**

- Platform overview and architecture
- User management and role assignments
- Tenant creation and management
- White-label configuration
- Billing and subscription management

**Day 2: Advanced Features**

- Analytics and reporting
- Security settings and monitoring
- Backup and recovery procedures
- Troubleshooting common issues

### 2. School Administrator Training

**Duration**: 1.5 days

**Day 1: School Setup**

- School profile configuration
- User role management
- Student enrollment process
- Academic year and grade setup
- Class creation and teacher assignments

**Half Day 2: Operations**

- White-label customization
- Parent portal configuration
- Financial management
- Reporting and analytics

### 3. Teacher Training

**Duration**: 1 day

**Morning Session**:

- System login and navigation
- Student management
- Attendance tracking
- Grade entry and assessment

**Afternoon Session**:

- Parent communication
- Daily activity logging (KB/TK)
- Academic history viewing
- Report generation

### 4. Parent Training

**Duration**: 2 hours (online session)

**Session Content**:

- Account setup and login
- Mobile app installation
- Viewing child information
- Academic history access
- Payment management
- Communication with teachers
- Notification settings

## User Guides

### Quick Start Guide for Parents

```
# Parent Portal Quick Start

## First Login
1. Visit your school's portal (e.g., https://sekolah.sch.id)
2. Click "Parent Login"
3. Enter credentials provided by school
4. Set up your preferred language
5. Download mobile app (optional)

## Daily Usage
### View Child's Activities (KB/TK)
1. Select child from dropdown
2. Go to "Daily Activities" tab
3. View photos and notes from teachers
4. Check meal times and nap schedules

### Check Academic Progress
1. Go to "Academic" tab
2. View current grades
3. Check attendance
4. Review teacher feedback

### Make Payments
1. Go to "Payments" tab
2. View outstanding invoices
3. Click "Pay Now" button
4. Choose payment method
5. Complete payment

### Communicate with Teachers
1. Go to "Communication" tab
2. Click "New Message"
3. Select teacher and write message
4. Attach files if needed
5. Send message

## Mobile App Features
- Real-time notifications
- Photo gallery of child's activities
- Quick payment access
- Offline viewing of academic history
```

### School Administrator Manual

```
# School Administrator Complete Guide

## Chapter 1: Getting Started
### Initial Setup
1. Complete school profile
2. Upload school logo and branding
3. Configure academic year
4. Set up grade levels and classes
5. Add teaching staff

### White-Label Customization
1. Access "Branding" section
2. Upload custom logo
3. Set color scheme
4. Configure custom domain (if applicable)
5. Customize email templates

## Chapter 2: User Management
### Adding Teachers
1. Go to "Staff Management"
2. Click "Add Teacher"
3. Fill in personal information
4. Assign role and permissions
5. Set class assignments

### Managing Parents
1. Parent accounts created during student enrollment
2. Reset passwords when needed
3. Update contact information
4. Manage language preferences

## Chapter 3: Student Management
### Student Enrollment
1. Go to "Students" → "Add New Student"
2. Enter student information
3. Upload required documents
4. Assign to class and grade
5. Link to parent accounts

### Academic History Tracking
1. View student progression
2. Monitor grade transitions
3. Track intervention programs
4. Generate academic reports

## Chapter 4: Academic Management
### Grade and Class Setup
1. Create grades for school type
2. Set up classes within grades
3. Assign homeroom teachers
4. Configure subjects and curricula

### Assessment Configuration
1. Set up grading scales
2. Configure assessment types
3. Create report card templates
4. Set academic year calendar

## Chapter 5: Financial Management
### Invoice Management
1. Create fee structures
2. Generate invoices
3. Track payments
4. Manage installment plans
5. Handle overdue payments

### Payment Integration
1. Configure payment gateways
2. Set up branded payment pages
3. Monitor transaction logs
4. Generate financial reports

## Chapter 6: Parent Engagement
### Communication Tools
1. Send announcements
2. Individual parent messaging
3. Event notifications
4. Emergency alerts

### Daily Activity Management (KB/TK)
1. Train teachers on activity logging
2. Set photo upload guidelines
3. Configure notification schedules
4. Monitor parent engagement

## Chapter 7: Reporting and Analytics
### Academic Reports
1. Student progress reports
2. Class performance analysis
3. Attendance summaries
4. Parent engagement metrics

### Administrative Reports
1. Enrollment statistics
2. Financial summaries
3. User activity logs
4. System usage analytics
```

## Success Metrics and KPIs

### Technical Performance Metrics

```typescript
// Monitoring dashboard configuration
const performanceMetrics = {
  system: {
    uptime: ">99.5%",
    responseTime: "<2000ms (95th percentile)",
    errorRate: "<1%",
    throughput: "1000+ requests/minute",
  },
  database: {
    queryTime: "<500ms average",
    connectionPool: "<80% utilization",
    diskUsage: "<80%",
    backupSuccess: "100%",
  },
  user: {
    parentAppUsage: ">80% monthly active",
    notificationDelivery: ">95% success rate",
    paymentSuccess: ">98% completion rate",
    supportTickets: "<5% of active users",
  },
  business: {
    studentRetention: ">95% year-over-year",
    parentSatisfaction: ">4.5/5 average rating",
    schoolAdoption: ">90% feature utilization",
    revenueGrowth: ">20% annually",
  },
};
```

### Implementation Timeline Summary

```
Phase 1 (Months 1-2): Foundation
├── ✅ Multi-tenant architecture
├── ✅ Authentication & authorization
├── ✅ Basic white-label system
└── ✅ Core user management

Phase 2 (Months 3-6): Core Features
├── ✅ Student management with NISN
├── ✅ Academic enrollment system
├── ✅ Parent portal foundation
├── ✅ Basic notification system
└── ✅ Academic history tracking

Phase 3 (Months 7-10): Advanced Features
├── ✅ Enhanced parent portal with multi-language
├── ✅ Daily activity tracking (KB/TK)
├── ✅ Advanced academic analytics
├── ✅ Payment system with white-label
├── ✅ Mobile application
└── ✅ Machine learning predictions

Phase 4 (Months 11-12): Production Ready
├── ✅ Security hardening
├── ✅ Performance optimization
├── ✅ Load testing
├── ✅ Deployment automation
├── ✅ Training materials
└── ✅ Documentation complete

Total Development Time: 12 months
Total Features: 200+ features across all modules
Estimated Lines of Code: 50,000+ (Backend + Frontend + Mobile)
Database Tables: 50+ optimized tables
API Endpoints: 150+ RESTful endpoints
```

## Risk Mitigation Strategies

### Technical Risks

1. **Scalability Issues**

   - Mitigation: Cloud-native architecture, caching layers, database optimization
   - Monitoring: Performance metrics, load testing

2. **Data Security Breaches**

   - Mitigation: Encryption, audit logs, security hardening
   - Monitoring: Security alerts, penetration testing

3. **System Downtime**
   - Mitigation: High availability setup, automated backups
   - Monitoring: 24/7 monitoring, disaster recovery procedures

### Business Risks

1. **Low User Adoption**

   - Mitigation: Comprehensive training, user-friendly design
   - Monitoring: Usage analytics, user feedback

2. **Competition**

   - Mitigation: Unique features (academic history, white-label, parent portal)
   - Monitoring: Market analysis, feature differentiation

3. **Regulatory Changes**
   - Mitigation: Flexible architecture, compliance monitoring
   - Monitoring: Regulatory updates, legal consultation

## Conclusion

This comprehensive roadmap provides a complete blueprint for developing a world-class educational management system specifically designed for the Indonesian market. The 12-month timeline balances feature richness with development feasibility, ensuring that each phase builds upon the previous one while maintaining high code quality and user experience.

Key success factors:

- **Solo Developer Friendly**: Leveraging AI tools and proven frameworks
- **Market-Specific**: Built for Indonesian educational requirements
- **Scalable Architecture**: Supports growth from single school to multi-tenant networks
- **Parent-Centric**: Unique focus on parent engagement across education levels
- **White-Label Ready**: Complete branding customization for competitive advantage

The system addresses the complete educational journey from KB through SMA, with specialized features for each education level, comprehensive academic history tracking, and advanced parent engagement tools that set it apart from existing solutions in the market.
