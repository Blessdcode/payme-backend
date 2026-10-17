function fakeDatabase() {
  const users = new Map();
  const sessions = new Map();
  const resetTokens = new Map();
  let pending = Promise.resolve();
  function safeUser(user) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      createdAt: user.createdAt,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
    };
  }
  function matches(session, where) {
    return (
      (!where.id || where.id === session.id) &&
      (!where.userId || where.userId === session.userId) &&
      (where.revokedAt === undefined ||
        where.revokedAt === session.revokedAt) &&
      (!where.refreshTokenHash ||
        where.refreshTokenHash === session.refreshTokenHash) &&
      (!where.expiresAt || session.expiresAt > where.expiresAt.gt)
    );
  }
  const database = {
    users,
    sessions,
    resetTokens,
    user: {
      create: async ({ data }) => {
        if ([...users.values()].some(user => user.email === data.email)) {
          throw Object.assign(new Error('Duplicate email'), { code: 'P2002' });
        }
        const user = { ...data, createdAt: new Date() };
        users.set(user.id, user);
        const session = {
          ...data.sessions.create,
          userId: user.id,
          revokedAt: null,
        };
        sessions.set(session.id, session);
        return safeUser(user);
      },
      findUnique: async ({ where }) => {
        const user = [...users.values()].find(user =>
          where.id ? user.id === where.id : user.email === where.email,
        );
        return user ? { ...user } : null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const user of users.values()) {
          if (
            user.id === where.id &&
            (where.passwordResetSentAt === undefined ||
              user.passwordResetSentAt?.getTime() ===
                where.passwordResetSentAt?.getTime()) &&
            (!where.OR ||
              where.OR.some(condition =>
                condition.passwordResetSentAt === null
                  ? user.passwordResetSentAt == null
                  : user.passwordResetSentAt <=
                    condition.passwordResetSentAt.lte,
              )) &&
            (where.passwordHash === undefined ||
              user.passwordHash === where.passwordHash)
          ) {
            Object.assign(user, data);
            count++;
          }
        }
        return { count };
      },
    },
    passwordResetToken: {
      upsert: async ({ where, create, update }) => {
        const row = resetTokens.has(where.userId)
          ? { ...resetTokens.get(where.userId), ...update }
          : { ...create };
        resetTokens.set(where.userId, row);
        return row;
      },
      findUnique: async ({ where }) => {
        const row = [...resetTokens.values()].find(
          row => row.tokenHash === where.tokenHash,
        );
        return row ? { ...row, user: { ...users.get(row.userId) } } : null;
      },
      deleteMany: async ({ where }) => {
        let count = 0;
        for (const [id, row] of resetTokens) {
          if (
            row.userId === where.userId &&
            (!where.tokenHash || row.tokenHash === where.tokenHash) &&
            (!where.expiresAt || row.expiresAt > where.expiresAt.gt)
          ) {
            resetTokens.delete(id);
            count++;
          }
        }
        return { count };
      },
    },
    session: {
      create: async ({ data }) => {
        const session = { ...data, revokedAt: null };
        sessions.set(session.id, session);
        return session;
      },
      findUnique: async ({ where }) => {
        const session = sessions.get(where.id);
        return session
          ? { ...session, user: safeUser(users.get(session.userId)) }
          : null;
      },
      findFirst: async ({ where }) => {
        const session = [...sessions.values()].find(item =>
          matches(item, where),
        );
        return session ? { user: safeUser(users.get(session.userId)) } : null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const session of sessions.values()) {
          if (matches(session, where)) {
            Object.assign(session, data);
            count++;
          }
        }
        return { count };
      },
    },
    $transaction: work => {
      const result = pending.then(async () => {
        const beforeTokens = structuredClone([...resetTokens]);
        const beforeUsers = structuredClone([...users]);
        const beforeSessions = structuredClone([...sessions]);
        try {
          return await work(database);
        } catch (error) {
          resetTokens.clear();
          beforeTokens.forEach(([key, value]) => resetTokens.set(key, value));
          users.clear();
          sessions.clear();
          beforeUsers.forEach(([key, value]) => users.set(key, value));
          beforeSessions.forEach(([key, value]) => sessions.set(key, value));
          throw error;
        }
      });
      pending = result.catch(() => {});
      return result;
    },
  };
  return database;
}

module.exports = { fakeDatabase };
