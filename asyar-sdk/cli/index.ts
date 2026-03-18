#!/usr/bin/env node
import { program } from 'commander'
import { registerValidate } from './commands/validate'
import { registerBuild } from './commands/build'
import { registerLink } from './commands/link'
import { registerDev } from './commands/dev'
import { registerPublish } from './commands/publish'

program
  .name('asyar')
  .description('Asyar Extension Developer CLI')
  .version('1.0.0')

registerValidate(program)
registerBuild(program)
registerLink(program)
registerDev(program)
registerPublish(program)

program.parse(process.argv)
