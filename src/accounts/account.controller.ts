import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { AccountsService } from './account.service'
import { TransferDto } from './dto/accounts.dto'

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post(':id/transfer')
  async transfer(@Param('id') fromId: string, @Body() body: TransferDto) {
    return await this.accounts.transfer(
      fromId,
      body.toAccountId,
      body.amountCents,
    )
  }
}
