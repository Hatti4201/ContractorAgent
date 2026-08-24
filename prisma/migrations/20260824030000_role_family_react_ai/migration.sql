-- Additive only: no existing row changes and no type rebuild, so a running application is unaffected.
ALTER TYPE "RoleFamily" ADD VALUE 'REACT_AI' AFTER 'REACT_FULLSTACK';
