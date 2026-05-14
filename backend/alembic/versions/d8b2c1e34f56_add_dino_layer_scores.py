"""add_dino_layer_scores

Revision ID: d8b2c1e34f56
Revises: c4e7a9f21b83
Create Date: 2026-05-14 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd8b2c1e34f56'
down_revision: Union[str, Sequence[str], None] = 'c4e7a9f21b83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('images', sa.Column('dino_layer_scores', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('images', 'dino_layer_scores')
