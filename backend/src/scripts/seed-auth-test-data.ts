#!/usr/bin/env ts-node

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthTestDataSeeder } from '../database/seeders/auth-test-data.seeder';

async function main() {
  // Create NestJS application context to get proper dependency injection
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const seeder = new AuthTestDataSeeder(prisma);

  try {
    console.log('🚀 Starting authentication test data seeding...\n');

    // Clean up existing test data
    await seeder.cleanupTestUsers();

    // Seed new test data
    await seeder.seedTestUsers();

    // Print credentials for testing
    await seeder.printTestCredentials();

    console.log('✅ Authentication test data seeding completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  } finally {
    await app.close();
  }
}

// Check if script is run directly
if (require.main === module) {
  main();
}
