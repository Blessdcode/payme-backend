require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { RegisterDto } = require('../dist/auth/dto/register.dto');
const { LoginDto } = require('../dist/auth/dto/login.dto');

test('registration normalizes names/email and enforces the bcrypt byte limit', async () => {
  const values = {
    email: '  ADA@EXAMPLE.COM ',
    firstName: ' Ada ',
    lastName: ' Okafor ',
    password: 'a'.repeat(8),
  };
  const dto = plainToInstance(RegisterDto, values);
  assert.deepEqual(await validate(dto), []);
  assert.equal(dto.email, 'ada@example.com');
  assert.equal(dto.firstName, 'Ada');
  assert.equal(dto.password, values.password);
  assert.ok(
    (
      await validate(
        plainToInstance(RegisterDto, { ...values, password: 'a'.repeat(7) }),
      )
    ).some(error => error.property === 'password'),
  );
  assert.ok(
    (
      await validate(
        plainToInstance(RegisterDto, { ...values, password: '😀'.repeat(24) }),
      )
    ).some(error => error.property === 'password'),
  );
  assert.ok(
    (
      await validate(
        plainToInstance(RegisterDto, { ...values, firstName: '  ' }),
      )
    ).some(error => error.property === 'firstName'),
  );
});

test('login keeps password whitespace and rejects non-string fields', async () => {
  const dto = plainToInstance(LoginDto, {
    email: ' ADA@EXAMPLE.COM ',
    password: ' keep spaces ',
  });
  assert.deepEqual(await validate(dto), []);
  assert.equal(dto.email, 'ada@example.com');
  assert.equal(dto.password, ' keep spaces ');
  const invalid = plainToInstance(LoginDto, {
    email: { unexpected: true },
    password: 123,
  });
  assert.ok((await validate(invalid)).length > 0);
});
