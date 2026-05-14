"""add_dino_layer_embeddings

Revision ID: c4e7a9f21b83
Revises: bdd17cfef66d
Create Date: 2026-05-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e7a9f21b83'
down_revision: Union[str, Sequence[str], None] = 'bdd17cfef66d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('images', sa.Column('dino_layer_embeddings', sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column('images', 'dino_layer_embeddings')
